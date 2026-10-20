import type { Case, UnlockCondition } from '../schema.js';
import { gameNow, pressureKey, type GameState } from '../state.js';
import { lookup } from './lookup.js';

export const GUARDED_PRESSURE = 2;

export function conditionsMet(c: Case, s: GameState, conds: UnlockCondition[] | undefined, now: number): boolean {
  if (!conds?.length) return true;
  return conds.every((u) => {
    switch (u.kind) {
      case 'evidence_found':
        return s.discovered.includes(u.evidenceId);
      case 'evidence_presented':
        return s.presented.some((p) => p.evidenceId === u.evidenceId && p.suspectId === u.suspectId);
      case 'fact_known':
        return s.knownFacts.includes(u.factId);
      case 'lab_ready':
        return s.labs.some((l) => l.evidenceId === u.evidenceId && gameNow(s, now) >= l.availableAt);
      case 'lie_broken':
        return s.brokenLies.includes(u.lieId);
    }
  });
}

/**
 * Facts this suspect is willing to state on this topic right now. Pressure is
 * read as already including the current question.
 */
export function allowedFacts(c: Case, s: GameState, suspectId: string, topicId: string, now: number): string[] {
  const l = lookup(c);
  const topic = l.topic.get(topicId);
  if (!topic) return [];
  const pressure = s.pressure[pressureKey(suspectId, topicId)] ?? 0;
  return topic.factIds.filter((factId) => {
    const k = l.knows.get(`${suspectId}:${factId}`);
    if (!k) return false;
    switch (k.tier) {
      case 'open':
        return true;
      case 'guarded':
        return pressure >= GUARDED_PRESSURE && conditionsMet(c, s, k.unlock, now);
      case 'locked':
        return conditionsMet(c, s, k.unlock, now);
      case 'never':
        return false;
    }
  });
}

/** Facts contradicted by lies this suspect is still telling; they must not leak alongside the lie. */
export function shieldedByLies(c: Case, s: GameState, suspectId: string): Set<string> {
  const lies = lookup(c).liesBySuspect.get(suspectId) ?? [];
  return new Set(lies.filter((lie) => !s.brokenLies.includes(lie.id)).map((lie) => lie.contradicts));
}
