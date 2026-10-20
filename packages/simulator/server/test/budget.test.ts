import { describe, expect, it } from 'vitest';
import { costMicros, dayKey } from '../budget.js';
import { harness, llmRequest } from './helpers.js';

describe('venice budget', () => {
  it('spend over cap returns 429 demo_resting', async () => {
    const h = harness();
    await h.deps.counters.add(`QUOTA#${dayKey(h.now.t)}`, 'venice', 10_000_000, h.now.t + 1);
    const res = await h.app.fetch(llmRequest());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ reason: 'demo_resting' });
    expect(h.upstream).toHaveLength(0);
  });

  it('the cap comes from config', async () => {
    const h = harness({}, { dailyCapUsd: 3 });
    await h.deps.counters.add(`QUOTA#${dayKey(h.now.t)}`, 'venice', 3_000_000, h.now.t + 1);
    expect((await h.app.fetch(llmRequest())).status).toBe(429);
  });

  it('records the cost of each completion from its usage', async () => {
    const h = harness();
    const res = await h.app.fetch(llmRequest());
    expect(res.status).toBe(200);
    // 2000 input tokens at $0.10/M + 100 output tokens at $0.50/M = $0.00025
    expect(await h.deps.counters.get(`QUOTA#${dayKey(h.now.t)}`, 'venice')).toBe(250);
    expect(costMicros('claude-sonnet-5-5', { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(2_000_000);
  });

  it('a new day starts with a fresh budget', async () => {
    const h = harness();
    await h.deps.counters.add(`QUOTA#${dayKey(h.now.t)}`, 'venice', 50_000_000, h.now.t + 1);
    h.now.t += 86_400_000;
    expect((await h.app.fetch(llmRequest())).status).toBe(200);
  });
});

describe('per-ip limit', () => {
  it('per-ip limit trips at 31st call', async () => {
    const h = harness();
    for (let i = 1; i <= 30; i++) expect((await h.app.fetch(llmRequest())).status, `call ${i}`).toBe(200);
    const res = await h.app.fetch(llmRequest());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: 'rate_limited' });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(h.upstream).toHaveLength(30);
  });

  it('other visitors are not affected', async () => {
    const h = harness();
    for (let i = 0; i < 31; i++) await h.app.fetch(llmRequest({}, '198.51.100.1'));
    expect((await h.app.fetch(llmRequest({}, '198.51.100.2'))).status).toBe(200);
  });

  it('the window resets after ten minutes', async () => {
    const h = harness();
    for (let i = 0; i < 31; i++) await h.app.fetch(llmRequest());
    h.now.t += 600_000;
    expect((await h.app.fetch(llmRequest())).status).toBe(200);
  });
});
