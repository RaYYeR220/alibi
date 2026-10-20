import type { Case, GameState } from '@alibi/canon';
import {
  ConflictError,
  dayKey,
  isExpiredGuest,
  metaOf,
  type CheckoutSession,
  type IdempotencyRecord,
  type InboxItem,
  type Job,
  type Stores,
} from './types.js';

const tick = () => new Promise<void>((r) => setImmediate(r));
const clone = <T>(v: T): T => structuredClone(v);

/** In-process stores for tests and local development; behaviour mirrors the DynamoDB stores. */
export function createMemoryStores(opts: { bundled: Case[]; clock?: () => number }): Stores {
  const clock = opts.clock ?? Date.now;
  const games = new Map<string, GameState>();
  const entitlements = new Map<string, number>();
  const orders = new Set<string>();
  const sessions = new Map<string, CheckoutSession>();
  const idem = new Map<string, IdempotencyRecord>();
  const jobs = new Map<string, Job>();
  const quotas = new Map<string, number>();
  const inbox = new Map<string, InboxItem[]>();
  const custom = new Map<string, { householdId: string; c: Case }>();
  const bundled = new Map(opts.bundled.map((c) => [c.meta.id, c]));

  return {
    games: {
      async get(id) {
        const s = games.get(id);
        return s && !isExpiredGuest(s, clock()) ? clone(s) : null;
      },
      async create(s) {
        games.set(s.gameId, clone(s));
      },
      async update(id, fn) {
        for (let attempt = 0; attempt < 4; attempt++) {
          const current = games.get(id);
          if (!current || isExpiredGuest(current, clock())) throw new Error(`no game ${id}`);
          const seen = current.version;
          await tick();
          const next = fn(clone(current));
          if (games.get(id)!.version !== seen) continue;
          const saved = { ...next, version: seen + 1 };
          games.set(id, clone(saved));
          return saved;
        }
        throw new ConflictError();
      },
      async listByHousehold(hh) {
        return [...games.values()].filter((g) => g.householdId === hh).map(clone);
      },
    },
    entitlements: {
      async has(hh, sku) {
        return (entitlements.get(`${hh}|${sku}`) ?? 0) > 0;
      },
      async grant(hh, sku, orderId) {
        if (orders.has(orderId)) return;
        orders.add(orderId);
        entitlements.set(`${hh}|${sku}`, (entitlements.get(`${hh}|${sku}`) ?? 0) + 1);
      },
      async consume(hh, sku) {
        const n = entitlements.get(`${hh}|${sku}`) ?? 0;
        if (n <= 0) return false;
        entitlements.set(`${hh}|${sku}`, n - 1);
        return true;
      },
    },
    checkouts: {
      async put(s) {
        sessions.set(s.id, clone(s));
      },
      async get(id) {
        return clone(sessions.get(id) ?? null);
      },
      async claim(id, from, to, now, staleMs) {
        const s = sessions.get(id);
        if (!s) return null;
        const stale = s.status === to && s.updatedAt < now - staleMs;
        if (!from.includes(s.status) && !stale) return null;
        const next = { ...s, status: to, updatedAt: now };
        sessions.set(id, next);
        return clone(next);
      },
      async getIdem(owner, key) {
        return clone(idem.get(`${owner}|${key}`) ?? null);
      },
      async putIdem(owner, key, record) {
        idem.set(`${owner}|${key}`, clone(record));
      },
    },
    jobs: {
      async create(job) {
        jobs.set(job.jobId, clone(job));
      },
      async get(id) {
        return clone(jobs.get(id) ?? null);
      },
      async update(id, patch) {
        const job = jobs.get(id);
        if (!job) throw new Error(`no job ${id}`);
        const next = { ...job, ...patch, updatedAt: clock() };
        jobs.set(id, next);
        return clone(next);
      },
      async cancelQueued(id, stage) {
        const job = jobs.get(id);
        if (job?.status !== 'queued') return false;
        jobs.set(id, { ...job, status: 'failed', stage, updatedAt: clock() });
        return true;
      },
      async listByHousehold(hh) {
        return [...jobs.values()].filter((j) => j.householdId === hh).map(clone);
      },
      async incrementToday(scope) {
        const key = `${dayKey(clock())}|${scope}`;
        const n = (quotas.get(key) ?? 0) + 1;
        quotas.set(key, n);
        return n;
      },
      async countToday(scope) {
        return quotas.get(`${dayKey(clock())}|${scope}`) ?? 0;
      },
    },
    inbox: {
      async add(hh, item) {
        inbox.set(hh, [...(inbox.get(hh) ?? []), clone(item)].sort((a, b) => a.at - b.at));
      },
      async list(hh, since) {
        return (inbox.get(hh) ?? []).filter((i) => since === undefined || i.at > since).map(clone);
      },
    },
    cases: {
      async list(hh) {
        const own = [...custom.values()].filter((x) => x.householdId === hh).map((x) => metaOf(x.c, true));
        return [...[...bundled.values()].map((c) => metaOf(c, false)), ...own];
      },
      async get(id, hh) {
        const b = bundled.get(id);
        if (b) return b;
        const x = custom.get(id);
        return x && x.householdId === hh ? x.c : null;
      },
      async putCustom(hh, c) {
        custom.set(c.meta.id, { householdId: hh, c });
      },
    },
  };
}
