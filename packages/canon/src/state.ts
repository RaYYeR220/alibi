import type { Case } from './schema.js';

export interface ServedTurn {
  turn: number;
  suspectId: string;
  topicId: string | null;
  factIds: string[];
  lieIds: string[];
}

export interface LabRequest {
  evidenceId: string;
  requestedAt: number;
  availableAt: number;
  collected: boolean;
}

export interface Accusation {
  suspectId: string;
  outcome: 'correct' | 'partial' | 'wrong';
  at: number;
}

export interface GameState {
  gameId: string;
  caseId: string;
  householdId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  discovered: string[];
  knownFacts: string[];
  served: ServedTurn[];
  brokenLies: string[];
  presented: { suspectId: string; evidenceId: string }[];
  /** Questions asked per "suspectId:topicId". */
  pressure: Record<string, number>;
  labs: LabRequest[];
  hintsUsed: number;
  accusations: Accusation[];
  status: 'active' | 'solved' | 'failed';
  score: number;
  /** Demo households can fast-forward the clock (e.g. "skip to tomorrow morning"). */
  clockOffsetMs: number;
}

export const STARTING_SCORE = 1000;

export function newGameState(c: Case, gameId: string, householdId: string | null, now: number): GameState {
  return {
    gameId,
    caseId: c.meta.id,
    householdId,
    version: 0,
    createdAt: now,
    updatedAt: now,
    discovered: [],
    knownFacts: [...c.meta.startingFacts],
    served: [],
    brokenLies: [],
    presented: [],
    pressure: {},
    labs: [],
    hintsUsed: 0,
    accusations: [],
    status: 'active',
    score: STARTING_SCORE,
    clockOffsetMs: 0,
  };
}

export const pressureKey = (suspectId: string, topicId: string) => `${suspectId}:${topicId}`;

/** The game's notion of "now", including any demo fast-forward. */
export const gameNow = (s: GameState, now: number) => now + s.clockOffsetMs;
