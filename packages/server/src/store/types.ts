import type { Case, GameState } from '@alibi/canon';

export const GUEST_TTL_MS = 24 * 3_600_000;

export class ConflictError extends Error {
  constructor(message = 'concurrent update, retries exhausted') {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface GameStore {
  get(gameId: string): Promise<GameState | null>;
  create(s: GameState): Promise<void>;
  /** Read-modify-write guarded by `version`; retried up to 3 times on a concurrent write. */
  update(gameId: string, fn: (s: GameState) => GameState): Promise<GameState>;
  listByHousehold(householdId: string): Promise<GameState[]>;
}

export interface EntitlementStore {
  has(householdId: string, sku: string): Promise<boolean>;
  /** Adds one credit per order; granting the same order again is a no-op. */
  grant(householdId: string, sku: string, orderId: string): Promise<void>;
  /** Uses up one credit (custom cases); false when there is none. */
  consume(householdId: string, sku: string): Promise<boolean>;
}

export interface CheckoutSession {
  id: string;
  householdId: string | null;
  sku: string;
  status: 'incomplete' | 'ready_for_complete' | 'complete_in_progress' | 'completed' | 'canceled';
  currency: 'USD';
  amountCents: number;
  title: string;
  orderId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IdempotencyRecord {
  bodyHash: string;
  status: number;
  response: unknown;
}

export interface CheckoutStore {
  put(session: CheckoutSession): Promise<void>;
  get(id: string): Promise<CheckoutSession | null>;
  /**
   * Atomically moves a session from one of `from` to `to` (a lock held longer than `staleMs`
   * may be taken over). Returns the updated session, or null when another request holds it.
   */
  claim(id: string, from: CheckoutSession['status'][], to: CheckoutSession['status'], now: number, staleMs: number): Promise<CheckoutSession | null>;
  /** Idempotency keys are scoped to the caller (OAuth client or household) that used them. */
  getIdem(owner: string, key: string): Promise<IdempotencyRecord | null>;
  putIdem(owner: string, key: string, record: IdempotencyRecord): Promise<void>;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  jobId: string;
  householdId: string;
  status: JobStatus;
  stage: string;
  percent: number;
  input: Record<string, unknown>;
  caseId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface JobStore {
  create(job: Job): Promise<void>;
  get(jobId: string): Promise<Job | null>;
  update(jobId: string, patch: Partial<Omit<Job, 'jobId'>>): Promise<Job>;
  listByHousehold(householdId: string): Promise<Job[]>;
  /** Atomically counts one more use of a daily quota and returns the new total. */
  incrementToday(scope: string): Promise<number>;
  countToday(scope: string): Promise<number>;
}

export interface InboxItem {
  id: string;
  kind: 'lab_ready' | 'custom_ready' | 'custom_failed';
  text: string;
  at: number;
  gameId?: string;
  caseId?: string;
}

export interface InboxStore {
  add(householdId: string, item: InboxItem): Promise<void>;
  list(householdId: string, since?: number): Promise<InboxItem[]>;
}

export interface CaseMeta {
  id: string;
  title: string;
  tagline: string;
  cover: string;
  priceCents: number;
  rating: Case['meta']['rating'];
  minutes: number;
  custom: boolean;
}

export interface CaseRepo {
  list(householdId: string | null): Promise<CaseMeta[]>;
  get(caseId: string, householdId: string | null): Promise<Case | null>;
  putCustom(householdId: string, c: Case): Promise<void>;
}

export interface Stores {
  games: GameStore;
  entitlements: EntitlementStore;
  checkouts: CheckoutStore;
  jobs: JobStore;
  inbox: InboxStore;
  cases: CaseRepo;
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

export const isExpiredGuest = (s: GameState, now: number) => s.householdId === null && s.updatedAt + GUEST_TTL_MS < now;

export function metaOf(c: Case, custom: boolean): CaseMeta {
  const m = c.meta;
  return { id: m.id, title: m.title, tagline: m.tagline, cover: m.cover, priceCents: m.priceCents, rating: m.rating, minutes: m.minutes, custom };
}
