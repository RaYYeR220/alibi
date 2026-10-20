import type { Case } from '../schema.js';
import type { GameState } from '../state.js';
import type { Demeanor } from '../views.js';
import { lookup } from './lookup.js';

export function demeanorFor(c: Case, s: GameState, suspectId: string): Demeanor {
  const l = lookup(c);
  const lies = l.liesBySuspect.get(suspectId) ?? [];
  if (lies.some((lie) => s.brokenLies.includes(lie.id))) return 'broken';

  const own = Object.entries(s.pressure).filter(([key]) => key.startsWith(`${suspectId}:`));
  const total = own.reduce((n, [, v]) => n + v, 0);
  if (total >= 6) return 'hostile';

  if (suspectId === c.solution.culprit) {
    const solutionFacts = new Set([c.solution.motiveFact, c.solution.meansFact, c.solution.opportunityFact]);
    const hot = new Set(c.topics.filter((t) => t.factIds.some((f) => solutionFacts.has(f))).map((t) => t.id));
    if (own.some(([key, v]) => hot.has(key.slice(suspectId.length + 1)) && v >= 2)) return 'nervous';
  }
  if (own.some(([, v]) => v >= 2)) return 'guarded';
  return 'calm';
}
