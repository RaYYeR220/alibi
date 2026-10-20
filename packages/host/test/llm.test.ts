import { describe, expect, it } from 'vitest';
import { createVeniceClient } from '../src/llm.js';

describe('venice client', () => {
  it('retries rate-limited and server errors with backoff', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      if (calls < 3) return new Response('{"error":"Rate limit exceeded"}', { status: calls === 1 ? 429 : 503 });
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    };
    const llm = createVeniceClient({ apiKey: 'k', fetch: fakeFetch as typeof fetch, retryDelayMs: 1 });
    const r = await llm.chat({ model: 'm', messages: [{ role: 'user', content: 'hello' }] });
    expect(r.message.content).toBe('hi');
    expect(calls).toBe(3);
  });

  it('does not retry client errors', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      return new Response('bad', { status: 400 });
    };
    const llm = createVeniceClient({ apiKey: 'k', fetch: fakeFetch as typeof fetch, retryDelayMs: 1 });
    await expect(llm.chat({ model: 'm', messages: [] })).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });
});
