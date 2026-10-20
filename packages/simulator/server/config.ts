import type { SimConfig } from './app.js';
import { DEFAULT_HOST_VOICE } from './voices.js';

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Limits for the public simulator; each can be tuned per deployment without a code change. */
export function configFromEnv(env: Record<string, string | undefined>): SimConfig {
  return {
    dailyCapUsd: num(env.DAILY_CAP_USD, 10),
    llmLimit: { max: num(env.LLM_CALLS_PER_WINDOW, 30), windowMs: num(env.LLM_WINDOW_MINUTES, 10) * 60_000 },
    ttsLimit: { max: num(env.TTS_CALLS_PER_WINDOW, 120), windowMs: 10 * 60_000 },
    ttsDailyChars: num(env.TTS_DAILY_CHARS, 400_000),
    visitorLimit: { max: num(env.VISITORS_PER_HOUR_PER_IP, 5), windowMs: 3_600_000 },
    visitorsPerDay: num(env.VISITORS_PER_DAY, 500),
    tokenLimit: { max: 60, windowMs: 10 * 60_000 },
    maxTokens: num(env.MAX_OUTPUT_TOKENS, 1024),
    maxRequestBytes: num(env.MAX_REQUEST_BYTES, 300_000),
    hostVoice: env.HOST_VOICE || DEFAULT_HOST_VOICE,
  };
}
