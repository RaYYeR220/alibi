import type { Anchor, Case } from '../schema.js';
import type { GameState } from '../state.js';
import { conditionsMet } from './allowed.js';
import { GameError } from './ask.js';
import { lookup } from './lookup.js';
import { settle } from './settle.js';

export interface PresentResult {
  outcome: 'not_found' | 'cracked' | 'no_effect' | 'already';
  brokenLieIds: string[];
  anchor?: Anchor;
  unlockedFactIds: string[];
}

export const CRACK_BONUS = 100;

export function present(
  c: Case,
  prev: GameState,
  input: { suspectId: string; evidenceId: string },
  now: number,
): { state: GameState; result: PresentResult } {
  const l = lookup(c);
  if (!l.suspect.has(input.suspectId)) {
    throw new GameError('unknown_entity', `no suspect "${input.suspectId}"`, c.suspects.map((x) => x.name));
  }
  const s: GameState = structuredClone(prev);
  const none = (outcome: PresentResult['outcome']) => ({ state: s, result: { outcome, brokenLieIds: [], unlockedFactIds: [] } });

  if (!l.evidence.has(input.evidenceId) || !s.discovered.includes(input.evidenceId)) return none('not_found');
  if (s.presented.some((p) => p.suspectId === input.suspectId && p.evidenceId === input.evidenceId)) return none('already');

  s.presented.push({ suspectId: input.suspectId, evidenceId: input.evidenceId });
  s.updatedAt = now;

  const cracked = (l.liesBySuspect.get(input.suspectId) ?? []).filter(
    (lie) => !s.brokenLies.includes(lie.id) && lie.exposedBy.includes(input.evidenceId),
  );
  if (cracked.length === 0) {
    settle(c, s);
    return none('no_effect');
  }

  s.brokenLies.push(...cracked.map((lie) => lie.id));
  s.score += CRACK_BONUS * cracked.length;

  // The crack itself is spoken aloud: the contradicted truth and anything the break unlocks become known.
  const unlocked = new Set<string>(cracked.map((lie) => lie.contradicts));
  for (const k of c.knowledge) {
    if (k.suspectId !== input.suspectId || k.tier !== 'locked') continue;
    const viaThisBreak = k.unlock?.some((u) => u.kind === 'lie_broken' && cracked.some((lie) => lie.id === u.lieId));
    if (viaThisBreak && conditionsMet(c, s, k.unlock, now)) unlocked.add(k.factId);
  }
  const unlockedFactIds = [...unlocked].filter((f) => !s.knownFacts.includes(f));
  s.knownFacts.push(...unlockedFactIds);
  settle(c, s);

  return {
    state: s,
    result: {
      outcome: 'cracked',
      brokenLieIds: cracked.map((lie) => lie.id),
      anchor: l.anchor.get(cracked[0]!.crackAnchorId),
      unlockedFactIds,
    },
  };
}
