import type { Anchor, Case, Evidence, Fact, Knowledge, Lie, Suspect, Topic } from '../schema.js';
import { buildTopicIndex, type TopicIndex } from '../topics.js';

export interface Lookup {
  fact: Map<string, Fact>;
  topic: Map<string, Topic>;
  suspect: Map<string, Suspect>;
  evidence: Map<string, Evidence>;
  lie: Map<string, Lie>;
  anchor: Map<string, Anchor>;
  /** knowledge rows keyed by "suspectId:factId" */
  knows: Map<string, Knowledge>;
  liesBySuspect: Map<string, Lie[]>;
  topicIndex: TopicIndex;
  /** facts that only the ending may reveal: the solution and every `never` fact */
  sealed: Set<string>;
}

const cache = new WeakMap<Case, Lookup>();

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

export function lookup(c: Case): Lookup {
  let l = cache.get(c);
  if (l) return l;
  const liesBySuspect = new Map<string, Lie[]>();
  for (const lie of c.lies) liesBySuspect.set(lie.suspectId, [...(liesBySuspect.get(lie.suspectId) ?? []), lie]);
  const sealed = new Set(c.knowledge.filter((k) => k.tier === 'never').map((k) => k.factId));
  l = {
    fact: byId(c.facts),
    topic: byId(c.topics),
    suspect: byId(c.suspects),
    evidence: byId(c.evidence),
    lie: byId(c.lies),
    anchor: byId(c.anchors),
    knows: new Map(c.knowledge.map((k) => [`${k.suspectId}:${k.factId}`, k])),
    liesBySuspect,
    topicIndex: buildTopicIndex(c),
    sealed,
  };
  cache.set(c, l);
  return l;
}

export const anchorFor = (c: Case, trigger: Anchor['trigger']) => c.anchors.find((a) => a.trigger === trigger);
