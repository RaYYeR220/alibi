import type { AuthInfo } from '@modelcontextprotocol/server';
import {
  guardOutput,
  resolveEntity,
  type Anchor,
  type AnchorRef,
  type Case,
  type EntityKind,
  type EvidenceItem,
  type GameState,
  type SuspectCard,
} from '@alibi/canon';
import type { Deps } from '../deps.js';

export type Tier = 'service' | 'user';

/** Which OAuth tier each tool needs; user-tier tools answer 401 to a service token (Alexa then links the account). */
export const TOOL_TIERS: Record<string, Tier> = {
  list_cases: 'service',
  start_case: 'service',
  ask_suspect: 'service',
  examine: 'service',
  present_evidence: 'service',
  get_case_board: 'service',
  get_hint: 'service',
  accuse: 'service',
  buy_case: 'user',
  request_lab_test: 'user',
  check_lab_results: 'user',
  create_custom_case: 'user',
  check_custom_case: 'user',
  my_progress: 'user',
  set_demo_clock: 'user',
};

export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface Ctx {
  deps: Deps;
  authInfo?: AuthInfo;
}

export const say = (text: string, view?: object): ToolResult => ({
  content: [{ type: 'text', text }],
  ...(view ? { structuredContent: view as Record<string, unknown> } : {}),
});

export const NO_SUCH_GAME =
  "I can't find that game. Say \"start\" and a case name to begin a new one, or \"my progress\" to pick up where you left off.";

export const CASE_CLOSED = 'This case is closed. Say "list cases" to start another one.';

export function householdOf(authInfo?: AuthInfo): string | null {
  const extra = authInfo?.extra as { tier?: string; sub?: string } | undefined;
  return extra?.tier === 'user' && typeof extra.sub === 'string' ? extra.sub : null;
}

export interface OpenGame {
  c: Case;
  s: GameState;
}

/**
 * Loads a game the caller may play. Guest games (no household) are reachable by
 * id; household games only by their own household. Without an id, a linked
 * household continues its most recent active game.
 */
export async function openGame(ctx: Ctx, gameId: string | undefined): Promise<OpenGame | null> {
  const hh = householdOf(ctx.authInfo);
  let s: GameState | null = null;
  if (gameId) {
    s = await ctx.deps.games.get(gameId);
    if (s && s.householdId !== null && s.householdId !== hh) s = null;
  } else if (hh) {
    s = (await ctx.deps.games.listByHousehold(hh)).filter((g) => g.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }
  if (!s) return null;
  const c = await ctx.deps.cases.get(s.caseId, s.householdId);
  return c ? { c, s } : null;
}

export const assetUrl = (deps: Deps, caseId: string, file: string) =>
  /^https?:\/\//.test(file) ? file : `${deps.assetsBaseUrl}/cases/${caseId}/${file}`;

export const cardWithAssets = (deps: Deps, caseId: string, card: SuspectCard): SuspectCard => ({
  ...card,
  portrait: assetUrl(deps, caseId, card.portrait),
});

export const evidenceWithAssets = (deps: Deps, caseId: string, item: EvidenceItem): EvidenceItem => ({
  ...item,
  image: assetUrl(deps, caseId, item.image),
});

export function anchorRef(deps: Deps, caseId: string, a: Anchor): AnchorRef {
  return { id: a.id, speakerId: a.speakerId, text: a.text, ...(a.audioUrl ? { audioUrl: assetUrl(deps, caseId, a.audioUrl) } : {}) };
}

const LABELS: Record<EntityKind, string> = { suspect: 'suspect', evidence: 'item', topic: 'topic', place: 'place' };

function namesOf(c: Case, kind: EntityKind, s?: GameState): string[] {
  switch (kind) {
    case 'suspect':
      return c.suspects.map((x) => x.name);
    case 'evidence':
      return c.evidence.filter((e) => s?.discovered.includes(e.id)).map((e) => e.name);
    case 'topic':
      return c.topics.map((t) => t.label);
    case 'place':
      return c.places.map((p) => p.name);
  }
}

/** Resolves a name the host passed; on a miss, a friendly non-error result listing the valid choices. */
export function pick(c: Case, kind: EntityKind, raw: string, s?: GameState): { id: string } | { miss: ToolResult } {
  const id = resolveEntity(c, kind, raw);
  if (id) return { id };
  const names = namesOf(c, kind, s);
  const list = names.length ? ` You can choose from: ${names.join(', ')}.` : kind === 'evidence' ? " You haven't found any evidence yet." : '';
  return { miss: say(`I'm not sure which ${LABELS[kind]} you mean by "${raw}".${list}`) };
}

/**
 * Fail-closed output check: a response that would mention anything the player
 * has not earned is replaced by the fallback and logged.
 */
export function guarded(c: Case, s: GameState, allowedNow: string[], result: ToolResult, fallback: () => ToolResult): { result: ToolResult; blocked: boolean } {
  const verdict = guardOutput(c, s, allowedNow, JSON.stringify(result), Date.now());
  if (verdict.ok) return { result, blocked: false };
  console.warn(JSON.stringify({ event: 'guard_block', gameId: s.gameId, caseId: c.meta.id, leaked: verdict.leakedFactIds }));
  return { result: fallback(), blocked: true };
}

/**
 * Runs one game action under optimistic locking. The action renders its result
 * against the new state; if the guard blocks it, the state is left unchanged.
 */
export async function act(
  ctx: Ctx,
  game: OpenGame,
  run: (s: GameState) => { state: GameState; result: ToolResult; allowedNow?: string[] },
  fallback: () => ToolResult,
): Promise<ToolResult> {
  let out: ToolResult = fallback();
  await ctx.deps.games.update(game.s.gameId, (current) => {
    const r = run(current);
    const g = guarded(game.c, r.state, r.allowedNow ?? [], r.result, fallback);
    out = g.result;
    return g.blocked ? current : r.state;
  });
  return out;
}

export const gameIdArg = 'The game_id returned by start_case. Linked households may omit it to continue their latest game.';
