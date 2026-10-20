import type { Case } from '../schema.js';
import type { GameState } from '../state.js';
import { lookup } from './lookup.js';

export const HINT_COST = 50;

export interface Hint {
  level: 1 | 2 | 3;
  text: string;
}

/** The next unmet step along the solution's minimal proof: find it, then use it, then accuse. */
function nextStep(c: Case, s: GameState): Hint {
  const l = lookup(c);
  for (const id of c.solution.minimalProof) {
    const e = l.evidence.get(id)!;
    if (!s.discovered.includes(id)) {
      if (e.foundAt) {
        const place = c.places.find((p) => p.id === e.foundAt)!;
        return { level: 1, text: `Take a closer look at ${place.name}.` };
      }
      const topic = c.topics.find((t) => e.givenBy && t.factIds.includes(e.givenBy));
      return { level: 1, text: `Keep asking about ${topic?.label ?? 'what people saw'}.` };
    }
    const exposes = c.lies.find((lie) => lie.exposedBy.includes(id) && !s.brokenLies.includes(lie.id));
    if (exposes) return { level: 2, text: `Someone's story doesn't fit the ${e.name}. Show it to them.` };
    const lab = s.labs.find((x) => x.evidenceId === id);
    if (e.lab && (!lab || !lab.collected)) {
      return { level: 2, text: lab ? `The lab is still working on the ${e.name}. Check back later.` : `Send the ${e.name} to the lab.` };
    }
  }
  return { level: 3, text: 'You have what you need. Who had the motive, the means and the opportunity?' };
}

export function hint(c: Case, prev: GameState): { state: GameState; hint: Hint } {
  const s: GameState = structuredClone(prev);
  s.hintsUsed += 1;
  s.score -= HINT_COST;
  return { state: s, hint: nextStep(c, s) };
}
