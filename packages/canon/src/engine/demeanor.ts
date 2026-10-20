import type { Case } from '../schema.js';
import type { GameState } from '../state.js';
import type { Demeanor } from '../views.js';
import { lookup } from './lookup.js';

/**
 * Topics on which a suspect has something to hide: a lie they are still telling, or a fact
 * they only give up under pressure or with evidence. Guilt plays no part, so a nervous
 * suspect is one with a secret, not necessarily the culprit.
 */
function sensitiveTopics(c: Case, s: GameState, suspectId: string): Set<string> {
  const l = lookup(c);
  const out = new Set<string>();
  for (const lie of l.liesBySuspect.get(suspectId) ?? []) {
    if (!s.brokenLies.includes(lie.id)) out.add(lie.topicId);
  }
  for (const k of c.knowledge) {
    if (k.suspectId !== suspectId || (k.tier !== 'guarded' && k.tier !== 'locked')) continue;
    for (const t of c.topics) if (t.factIds.includes(k.factId)) out.add(t.id);
  }
  return out;
}

export function demeanorFor(c: Case, s: GameState, suspectId: string): Demeanor {
  const l = lookup(c);
  const lies = l.liesBySuspect.get(suspectId) ?? [];
  if (lies.some((lie) => s.brokenLies.includes(lie.id))) return 'broken';

  const own = Object.entries(s.pressure).filter(([key]) => key.startsWith(`${suspectId}:`));
  const total = own.reduce((n, [, v]) => n + v, 0);
  if (total >= 6) return 'hostile';

  const hot = sensitiveTopics(c, s, suspectId);
  if (own.some(([key, v]) => v >= 2 && hot.has(key.slice(suspectId.length + 1)))) return 'nervous';
  if (own.some(([, v]) => v >= 2)) return 'guarded';
  return 'calm';
}
