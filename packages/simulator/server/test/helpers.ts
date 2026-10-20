import { memoryCounters } from '../counters.js';
import { createSimApp, type SimConfig, type SimDeps } from '../app.js';

export const CONFIG: SimConfig = {
  dailyCapUsd: 10,
  llmLimit: { max: 30, windowMs: 600_000 },
  ttsLimit: { max: 120, windowMs: 600_000 },
  ttsDailyChars: 400_000,
  visitorLimit: { max: 5, windowMs: 3_600_000 },
  visitorsPerDay: 500,
  tokenLimit: { max: 60, windowMs: 600_000 },
  maxTokens: 1024,
  maxRequestBytes: 300_000,
  hostVoice: 'Brian',
};

export interface Harness {
  app: ReturnType<typeof createSimApp>;
  deps: SimDeps & { counters: ReturnType<typeof memoryCounters> };
  upstream: object[];
  now: { t: number };
}

/** The simulator backend with in-memory counters and recorded upstream calls. */
export function harness(overrides: Partial<SimDeps> = {}, config: Partial<SimConfig> = {}): Harness {
  const upstream: object[] = [];
  const now = { t: Date.parse('2026-10-21T12:00:00Z') };
  const deps = {
    counters: memoryCounters(),
    clock: () => now.t,
    config: { ...CONFIG, ...config },
    venice: async (body: object) => {
      upstream.push(body);
      return {
        status: 200,
        json: {
          choices: [{ message: { role: 'assistant', content: 'The study door was locked.' } }],
          usage: { prompt_tokens: 2000, completion_tokens: 100 },
        },
      };
    },
    polly: async () => new Uint8Array([0x49, 0x44, 0x33]),
    visitors: async () => ({ username: 'visitor-abc', password: 'Brass-Owl-Quill-4821' }),
    serviceToken: async () => ({ accessToken: 'service-token', expiresAt: now.t + 3_600_000 }),
    publicConfig: async () => ({
      mcpUrl: 'https://api.alibi.test/mcp',
      ucpBase: 'https://api.alibi.test/ucp',
      cognitoDomain: 'https://auth.alibi.test',
      clientId: 'sim-client',
      sandboxOrigin: 'https://sandbox.alibi.test',
    }),
    ipOf: (req: Request) => req.headers.get('x-test-ip') ?? '203.0.113.7',
    ...overrides,
  } as Harness['deps'];
  return { app: createSimApp(deps), deps, upstream, now };
}

export const llmRequest = (body: object = {}, ip = '203.0.113.7') =>
  new Request('https://sim.alibi.test/api/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-ip': ip },
    body: JSON.stringify({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'Open Alibi' }], ...body }),
  });

export const post = (path: string, body: object, ip = '203.0.113.7') =>
  new Request(`https://sim.alibi.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-ip': ip },
    body: JSON.stringify(body),
  });
