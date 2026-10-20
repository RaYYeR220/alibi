import type { Anchor, Case } from '../schema.js';
import { pressureKey, type GameState } from '../state.js';
import { resolveTopic } from '../topics.js';
import type { Demeanor } from '../views.js';
import { allowedFacts, shieldedByLies } from './allowed.js';
import { demeanorFor } from './demeanor.js';
import { lookup } from './lookup.js';

export interface Packet {
  suspect: { id: string; name: string; role: string };
  topicId: string | null;
  demeanor: Demeanor;
  says: { factId: string; text: string }[];
  claims: { lieId: string; text: string }[];
  deflect: boolean;
  style: string;
  anchor?: Anchor;
  newlyKnownFactIds: string[];
}

export interface AskInput {
  suspectId: string;
  topicId?: string;
  question?: string;
}

export class GameError extends Error {
  constructor(
    readonly code: 'not_lab_testable' | 'game_over' | 'unknown_entity',
    message: string,
    readonly choices: string[] = [],
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export function ask(c: Case, prev: GameState, input: AskInput, now: number): { state: GameState; packet: Packet } {
  const l = lookup(c);
  const suspect = l.suspect.get(input.suspectId);
  if (!suspect) throw new GameError('unknown_entity', `no suspect "${input.suspectId}"`, c.suspects.map((s) => s.name));

  const s: GameState = structuredClone(prev);
  const topicId =
    input.topicId && l.topic.has(input.topicId)
      ? input.topicId
      : resolveTopic(l.topicIndex, suspect.id, input.question ?? input.topicId ?? '');

  let says: Packet['says'] = [];
  let claims: Packet['claims'] = [];
  if (topicId) {
    const key = pressureKey(suspect.id, topicId);
    s.pressure[key] = (s.pressure[key] ?? 0) + 1;
    const shielded = shieldedByLies(c, s, suspect.id);
    says = allowedFacts(c, s, suspect.id, topicId, now)
      .filter((f) => !shielded.has(f))
      .map((factId) => ({ factId, text: l.fact.get(factId)!.text }));
    claims = (l.liesBySuspect.get(suspect.id) ?? [])
      .filter((lie) => lie.topicId === topicId && !s.brokenLies.includes(lie.id))
      .map((lie) => ({ lieId: lie.id, text: lie.claim }));
  }

  const newlyKnownFactIds = says.map((x) => x.factId).filter((f) => !s.knownFacts.includes(f));
  s.knownFacts.push(...newlyKnownFactIds);
  s.served.push({
    turn: s.served.length + 1,
    suspectId: suspect.id,
    topicId,
    factIds: says.map((x) => x.factId),
    lieIds: claims.map((x) => x.lieId),
  });
  s.updatedAt = now;

  const packet: Packet = {
    suspect: { id: suspect.id, name: suspect.name, role: suspect.role },
    topicId,
    demeanor: demeanorFor(c, s, suspect.id),
    says,
    claims,
    deflect: says.length === 0 && claims.length === 0,
    style: `${suspect.persona.speech} Traits: ${suspect.persona.traits.join(', ')}.`,
    newlyKnownFactIds,
  };
  return { state: s, packet };
}
