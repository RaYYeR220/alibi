import type { Case } from '../schema.js';
import type { GameState } from '../state.js';
import { lookup } from './lookup.js';

/**
 * Applies the knock-on effects every action shares, in place on a cloned
 * state: evidence handed over through a known fact becomes discovered, and
 * discovered evidence makes the facts it implies known. Returns newly known facts.
 */
export function settle(c: Case, s: GameState): string[] {
  const learned: string[] = [];
  const learn = (factId: string) => {
    if (!s.knownFacts.includes(factId)) {
      s.knownFacts.push(factId);
      learned.push(factId);
    }
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of c.evidence) {
      if (e.givenBy && !s.discovered.includes(e.id) && s.knownFacts.includes(e.givenBy)) {
        s.discovered.push(e.id);
        changed = true;
      }
    }
    for (const id of s.discovered) {
      for (const f of lookup(c).evidence.get(id)?.implies ?? []) {
        if (!s.knownFacts.includes(f)) {
          learn(f);
          changed = true;
        }
      }
    }
  }
  return learned;
}
