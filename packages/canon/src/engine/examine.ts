import type { Case, Evidence } from '../schema.js';
import type { GameState } from '../state.js';
import { resolveEntity } from '../topics.js';
import { GameError } from './ask.js';
import { lookup } from './lookup.js';
import { settle } from './settle.js';

export interface ExamineResult {
  found: Evidence[];
  placeId?: string;
  nothingNew: boolean;
}

export function examine(c: Case, prev: GameState, input: { target: string }, now: number): { state: GameState; result: ExamineResult } {
  const s: GameState = structuredClone(prev);
  s.updatedAt = now;

  const placeId = resolveEntity(c, 'place', input.target);
  if (placeId) {
    const found = c.evidence.filter((e) => e.foundAt === placeId && !s.discovered.includes(e.id));
    s.discovered.push(...found.map((e) => e.id));
    settle(c, s);
    return { state: s, result: { found, placeId, nothingNew: found.length === 0 } };
  }

  const evidenceId = resolveEntity(c, 'evidence', input.target);
  if (evidenceId) {
    // Re-describe evidence the player holds; never confirm evidence they have not found.
    const known = s.discovered.includes(evidenceId) ? [lookup(c).evidence.get(evidenceId)!] : [];
    return { state: s, result: { found: known, nothingNew: true } };
  }

  throw new GameError('unknown_entity', `nothing called "${input.target}" to search`, c.places.map((p) => p.name));
}
