import { describe, expect, it } from 'vitest';
import { harness, llmRequest, post } from './helpers.js';

describe('llm proxy', () => {
  it('only allows the host models', async () => {
    const h = harness();
    const res = await h.app.fetch(llmRequest({ model: 'some-unlisted-model' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ reason: 'model_not_allowed' });
    expect(h.upstream).toHaveLength(0);
  });

  it('clamps output length and drops the provider system prompt', async () => {
    const h = harness();
    await h.app.fetch(llmRequest({ max_tokens: 50_000, tools: [{ type: 'function', function: { name: 'list_cases', parameters: {} } }] }));
    expect(h.upstream[0]).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      tools: [{ type: 'function', function: { name: 'list_cases' } }],
      venice_parameters: { include_venice_system_prompt: false },
    });
  });

  it('rejects oversized conversations before they cost anything', async () => {
    const h = harness();
    const res = await h.app.fetch(llmRequest({ messages: [{ role: 'user', content: 'x'.repeat(400_000) }] }));
    expect(res.status).toBe(413);
    expect(h.upstream).toHaveLength(0);
  });

  it('upstream failures surface as 502 without leaking details', async () => {
    const h = harness({ venice: async () => ({ status: 500, json: { error: 'secret upstream detail' } }) });
    const res = await h.app.fetch(llmRequest());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});

describe('speech', () => {
  it('synthesizes with an allowed voice and falls back to the host voice', async () => {
    const voices: string[] = [];
    const h = harness({
      polly: async (_text, voice) => {
        voices.push(voice);
        return new Uint8Array([1, 2, 3]);
      },
    });
    const ok = await h.app.fetch(post('/api/tts', { text: 'Where were you at nine?', voice: 'Ruth' }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    await h.app.fetch(post('/api/tts', { text: 'Hello', voice: 'NotAVoice' }));
    expect(voices).toEqual(['Ruth', 'Brian']);
  });

  it('refuses empty or very long text', async () => {
    const h = harness();
    expect((await h.app.fetch(post('/api/tts', { text: '' }))).status).toBe(400);
    expect((await h.app.fetch(post('/api/tts', { text: 'x'.repeat(1601) }))).status).toBe(400);
  });

  it('stops speaking when the daily character budget is spent', async () => {
    const h = harness({}, { ttsDailyChars: 10 });
    expect((await h.app.fetch(post('/api/tts', { text: 'Ten chars!' }))).status).toBe(200);
    const res = await h.app.fetch(post('/api/tts', { text: 'One more' }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ reason: 'demo_resting' });
  });
});

describe('visitors and tokens', () => {
  it('creates a demo household per visitor', async () => {
    const h = harness();
    const res = await h.app.fetch(post('/api/visitor', {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: 'visitor-abc', password: 'Brass-Owl-Quill-4821' });
  });

  it('limits households per address', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) expect((await h.app.fetch(post('/api/visitor', {}))).status).toBe(200);
    expect((await h.app.fetch(post('/api/visitor', {}))).status).toBe(429);
  });

  it('hands out the shared guest token without the client secret', async () => {
    const h = harness();
    const res = await h.app.fetch(new Request('https://sim.alibi.test/api/service-token'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ access_token: 'service-token', expires_at: h.now.t + 3_600_000 });
  });

  it('publishes the endpoints the web app needs', async () => {
    const h = harness();
    const res = await h.app.fetch(new Request('https://sim.alibi.test/api/config'));
    expect(await res.json()).toMatchObject({
      mcpUrl: 'https://api.alibi.test/mcp',
      sandboxOrigin: 'https://sandbox.alibi.test',
      models: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
      defaultModel: 'claude-haiku-5-5',
      resting: false,
    });
  });
});

describe('checkout relay', () => {
  it("forwards the payment phase's checkout calls to the merchant with their headers", async () => {
    const seen: { path: string; method: string; headers: Headers; body?: string }[] = [];
    const h = harness({
      merchant: async (path, init) => {
        seen.push({ path, method: init.method, headers: new Headers(init.headers), body: init.body });
        return Response.json({ id: 'cs_1', status: 'completed' });
      },
    });
    const res = await h.app.fetch(
      new Request('https://sim.alibi.test/api/ucp/checkout-sessions/cs_1/complete', {
        method: 'POST',
        headers: { authorization: 'Bearer hh', 'idempotency-key': 'k-1', 'content-type': 'application/json', cookie: 'x=1' },
        body: '{"payment":{}}',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'cs_1', status: 'completed' });
    expect(seen[0]).toMatchObject({ path: '/checkout-sessions/cs_1/complete', method: 'POST', body: '{"payment":{}}' });
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer hh');
    expect(seen[0]!.headers.get('idempotency-key')).toBe('k-1');
    expect(seen[0]!.headers.get('cookie')).toBeNull();
  });

  it('relays nothing but checkout sessions', async () => {
    const h = harness({ merchant: async () => Response.json({}) });
    expect((await h.app.fetch(new Request('https://sim.alibi.test/api/ucp/../mcp', { method: 'POST' }))).status).toBe(404);
    expect((await h.app.fetch(new Request('https://sim.alibi.test/api/ucp/orders/1'))).status).toBe(404);
  });
});
