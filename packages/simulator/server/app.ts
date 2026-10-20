import { Hono, type Context } from 'hono';
import { costMicros, dayKey, MODELS, spendLedger } from './budget.js';
import type { Counters } from './counters.js';
import { hit, type Limit } from './ratelimit.js';
import { VOICES } from './voices.js';

export interface SimConfig {
  /** Venice spend cap per UTC day, enforced before every completion. */
  dailyCapUsd: number;
  llmLimit: Limit;
  ttsLimit: Limit;
  /** Polly characters per UTC day across all visitors. */
  ttsDailyChars: number;
  visitorLimit: Limit;
  visitorsPerDay: number;
  tokenLimit: Limit;
  maxTokens: number;
  maxRequestBytes: number;
  hostVoice: string;
}

/** What the browser needs to reach the add-on; none of it is secret. */
export interface PublicConfig {
  mcpUrl: string;
  ucpBase: string;
  cognitoDomain: string;
  clientId: string;
  sandboxOrigin: string;
}

export interface SimDeps {
  counters: Counters;
  clock: () => number;
  config: SimConfig;
  /** One chat-completions call to Venice with the server-held key. */
  venice: (body: object) => Promise<{ status: number; json: unknown }>;
  polly: (text: string, voice: string) => Promise<Uint8Array>;
  /** Creates an isolated demo household and returns its sign-in. */
  visitors: () => Promise<{ username: string; password: string }>;
  /** The shared client-credentials token guests play with. */
  serviceToken: () => Promise<{ accessToken: string; expiresAt: number }>;
  publicConfig: () => Promise<PublicConfig>;
  /**
   * The add-on's UCP checkout API. The assistant's payment phase calls it from
   * the backend, the way a voice assistant's cloud calls a merchant.
   */
  merchant: (path: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;
  ipOf: (req: Request, c: Context) => string;
}

/** Only checkout sessions travel through the relay: create, read, update, complete, cancel. */
const CHECKOUT_PATH = /^\/checkout-sessions(\/[A-Za-z0-9_-]+(\/(complete|cancel))?)?$/;
const RELAYED_HEADERS = ['authorization', 'content-type', 'idempotency-key', 'request-id'];

export const DEFAULT_MODEL = 'claude-haiku-5-5';
const MAX_TTS_CHARS = 1600;
const DAY_MS = 86_400_000;

type ChatBody = {
  model?: unknown;
  messages?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
};

const resting = (c: Context) => c.json({ reason: 'demo_resting' }, 429);

/** A rough count for replies that come back without usage: about four characters per token. */
function estimateUsage(raw: string, json: unknown) {
  const out = JSON.stringify((json as { choices?: unknown } | null)?.choices ?? '');
  return { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(out.length / 4) };
}

/**
 * The simulator's backend: an LLM proxy with a daily spend cap, speech,
 * demo households and the guest token. Every limit is enforced here, never
 * in the browser.
 */
export function createSimApp(deps: SimDeps): Hono {
  const app = new Hono();
  const cfg = deps.config;
  const ledger = spendLedger(deps.counters, deps.clock);
  const capMicros = () => Math.round(cfg.dailyCapUsd * 1_000_000);

  const limited = async (c: Context, scope: string, limit: Limit) => {
    const r = await hit(deps.counters, scope, deps.ipOf(c.req.raw, c), limit, deps.clock());
    if (r.ok) return null;
    c.header('Retry-After', String(r.retryAfterS));
    return c.json({ reason: 'rate_limited', retryAfter: r.retryAfterS }, 429);
  };

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.post('/api/llm', async (c) => {
    const raw = await c.req.text();
    if (raw.length > cfg.maxRequestBytes) return c.json({ reason: 'too_large' }, 413);
    let body: ChatBody;
    try {
      body = JSON.parse(raw) as ChatBody;
    } catch {
      return c.json({ reason: 'bad_request' }, 400);
    }
    const model = typeof body.model === 'string' ? body.model : DEFAULT_MODEL;
    if (!MODELS.includes(model)) return c.json({ reason: 'model_not_allowed' }, 400);
    if (!Array.isArray(body.messages) || body.messages.length === 0) return c.json({ reason: 'bad_request' }, 400);

    const refused = await limited(c, 'llm', cfg.llmLimit);
    if (refused) return refused;
    if ((await ledger.spentMicros()) >= capMicros()) return resting(c);

    const temperature = typeof body.temperature === 'number' ? Math.min(1, Math.max(0, body.temperature)) : 0.4;
    const asked = typeof body.max_tokens === 'number' && body.max_tokens > 0 ? body.max_tokens : 600;
    const upstream = {
      model,
      messages: body.messages,
      ...(Array.isArray(body.tools) && body.tools.length ? { tools: body.tools, tool_choice: body.tool_choice ?? 'auto' } : {}),
      temperature,
      max_tokens: Math.min(Math.floor(asked), cfg.maxTokens),
      venice_parameters: { include_venice_system_prompt: false },
    };
    const res = await deps.venice(upstream);
    if (res.status !== 200) return c.json({ reason: 'upstream_error', status: res.status }, 502);
    const usage = (res.json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    await ledger.record(costMicros(model, usage?.prompt_tokens !== undefined ? usage : estimateUsage(raw, res.json)));
    return c.json(res.json as object);
  });

  app.post('/api/tts', async (c) => {
    let body: { text?: unknown; voice?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ reason: 'bad_request' }, 400);
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > MAX_TTS_CHARS) return c.json({ reason: 'bad_request' }, 400);
    const voice = typeof body.voice === 'string' && VOICES.has(body.voice) ? body.voice : cfg.hostVoice;

    const refused = await limited(c, 'tts', cfg.ttsLimit);
    if (refused) return refused;
    const now = deps.clock();
    const used = await deps.counters.add(`QUOTA#${dayKey(now)}`, 'polly', text.length, now + 3 * DAY_MS);
    if (used > cfg.ttsDailyChars) return resting(c);

    const audio = await deps.polly(text, voice);
    return new Response(audio as BodyInit, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
  });

  app.post('/api/visitor', async (c) => {
    const refused = await limited(c, 'visitor', cfg.visitorLimit);
    if (refused) return refused;
    const now = deps.clock();
    const today = await deps.counters.add(`QUOTA#${dayKey(now)}`, 'visitors', 1, now + 3 * DAY_MS);
    if (today > cfg.visitorsPerDay) return resting(c);
    return c.json(await deps.visitors());
  });

  app.get('/api/service-token', async (c) => {
    const refused = await limited(c, 'token', cfg.tokenLimit);
    if (refused) return refused;
    const t = await deps.serviceToken();
    return c.json({ access_token: t.accessToken, expires_at: t.expiresAt });
  });

  app.get('/api/config', async (c) => {
    const spent = await ledger.spentMicros();
    return c.json({
      ...(await deps.publicConfig()),
      models: MODELS,
      defaultModel: DEFAULT_MODEL,
      hostVoice: cfg.hostVoice,
      resting: spent >= capMicros(),
    });
  });

  app.all('/api/ucp/*', async (c) => {
    const path = c.req.path.slice('/api/ucp'.length);
    if (!CHECKOUT_PATH.test(path)) return c.json({ reason: 'not_found' }, 404);
    const method = c.req.method;
    if (method !== 'GET' && method !== 'POST' && method !== 'PUT') return c.json({ reason: 'method_not_allowed' }, 405);
    const refused = await limited(c, 'ucp', cfg.tokenLimit);
    if (refused) return refused;
    const headers: Record<string, string> = {};
    for (const h of RELAYED_HEADERS) {
      const v = c.req.header(h);
      if (v) headers[h] = v;
    }
    const res = await deps.merchant(path, { method, headers, ...(method === 'GET' ? {} : { body: await c.req.text() }) });
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
    });
  });

  app.all('/api/*', (c) => c.json({ reason: 'not_found' }, 404));

  app.onError((err, c) => {
    console.error('[sim]', err);
    return c.json({ reason: 'server_error' }, 500);
  });

  return app;
}
