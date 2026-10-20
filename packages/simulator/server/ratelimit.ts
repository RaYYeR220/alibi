import type { Counters } from './counters.js';

export interface Limit {
  max: number;
  windowMs: number;
}

export type LimitResult = { ok: true; count: number } | { ok: false; count: number; retryAfterS: number };

/**
 * Fixed-window counter per (scope, key): the call that takes the window past
 * `max` is refused, and so is every later call in that window.
 */
export async function hit(counters: Counters, scope: string, key: string, limit: Limit, now: number): Promise<LimitResult> {
  const start = Math.floor(now / limit.windowMs) * limit.windowMs;
  const end = start + limit.windowMs;
  const count = await counters.add(`RATE#${scope}#${key}`, String(start), 1, end + 3_600_000);
  if (count <= limit.max) return { ok: true, count };
  return { ok: false, count, retryAfterS: Math.max(1, Math.ceil((end - now) / 1000)) };
}
