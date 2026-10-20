import type { Anchor, Case } from '../schema.js';
import type { GameState } from '../state.js';
import { GameError } from './ask.js';
import { anchorFor, lookup } from './lookup.js';

export const MAX_WRONG = 2;
const SOLVE_BONUS = 500;
const PARTIAL_COST = 100;
const WRONG_COST = 200;

export interface Verdict {
  outcome: 'correct' | 'partial' | 'wrong';
  ending: Anchor;
  confession?: Anchor;
  revealedFactIds: string[];
  score: number;
  attemptsLeft: number;
}

export interface AccuseInput {
  suspectId: string;
  motiveFactId?: string;
  meansFactId?: string;
  evidenceIds: string[];
}

/** Everything the ending may say: the solution facts plus every sealed (`never`) fact. */
export function solutionFactIds(c: Case): string[] {
  const { motiveFact, meansFact, opportunityFact } = c.solution;
  return [...new Set([motiveFact, meansFact, opportunityFact, ...lookup(c).sealed])];
}

export function accuse(c: Case, prev: GameState, input: AccuseInput, now: number): { state: GameState; verdict: Verdict } {
  if (prev.status !== 'active') throw new GameError('game_over', 'game over: this case is closed');
  if (!lookup(c).suspect.has(input.suspectId)) {
    throw new GameError('unknown_entity', `no suspect "${input.suspectId}"`, c.suspects.map((x) => x.name));
  }
  const s: GameState = structuredClone(prev);
  s.updatedAt = now;

  const rightPerson = input.suspectId === c.solution.culprit;
  const proven = input.evidenceIds.some((e) => c.solution.minimalProof.includes(e) && s.discovered.includes(e));
  const outcome: Verdict['outcome'] = rightPerson ? (proven ? 'correct' : 'partial') : 'wrong';
  s.accusations.push({ suspectId: input.suspectId, outcome, at: now });

  if (outcome === 'correct') {
    s.status = 'solved';
    s.score += SOLVE_BONUS;
  } else if (outcome === 'partial') {
    s.score -= PARTIAL_COST;
  } else {
    s.score -= WRONG_COST;
    if (s.accusations.filter((a) => a.outcome === 'wrong').length >= MAX_WRONG) s.status = 'failed';
  }

  const closed = s.status !== 'active';
  const revealedFactIds = closed ? solutionFactIds(c) : [];
  if (closed) for (const f of revealedFactIds) if (!s.knownFacts.includes(f)) s.knownFacts.push(f);

  const trigger = outcome === 'correct' ? 'ending_correct' : outcome === 'partial' ? 'ending_partial' : 'ending_wrong';
  return {
    state: s,
    verdict: {
      outcome,
      ending: anchorFor(c, trigger)!,
      confession: outcome === 'correct' ? anchorFor(c, 'confession') : undefined,
      revealedFactIds,
      score: s.score,
      attemptsLeft: Math.max(0, MAX_WRONG - s.accusations.filter((a) => a.outcome === 'wrong').length),
    },
  };
}
