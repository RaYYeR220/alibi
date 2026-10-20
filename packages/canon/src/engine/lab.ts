import type { Case } from '../schema.js';
import { gameNow, type GameState } from '../state.js';
import { GameError } from './ask.js';
import { lookup } from './lookup.js';
import { settle } from './settle.js';

const HOUR_MS = 3_600_000;

export function requestLab(
  c: Case,
  prev: GameState,
  input: { evidenceId: string },
  now: number,
): { state: GameState; ticket: { evidenceId: string; availableAt: number } } {
  const evidence = lookup(c).evidence.get(input.evidenceId);
  if (!evidence || !prev.discovered.includes(input.evidenceId)) {
    throw new GameError('unknown_entity', "you haven't found anything like that yet", prev.discovered);
  }
  if (!evidence.lab) {
    throw new GameError('not_lab_testable', `the lab can't learn anything more from the ${evidence.name}`);
  }
  const existing = prev.labs.find((l) => l.evidenceId === input.evidenceId);
  if (existing) return { state: prev, ticket: { evidenceId: existing.evidenceId, availableAt: existing.availableAt } };

  const s: GameState = structuredClone(prev);
  const availableAt = gameNow(s, now) + evidence.lab.delayHours * HOUR_MS;
  s.labs.push({ evidenceId: input.evidenceId, requestedAt: gameNow(s, now), availableAt, collected: false });
  s.updatedAt = now;
  return { state: s, ticket: { evidenceId: input.evidenceId, availableAt } };
}

export function collectLab(
  c: Case,
  prev: GameState,
  now: number,
): { state: GameState; results: { evidenceId: string; factIds: string[] }[] } {
  const ready = prev.labs.filter((l) => !l.collected && gameNow(prev, now) >= l.availableAt);
  if (ready.length === 0) return { state: prev, results: [] };

  const s: GameState = structuredClone(prev);
  const results = ready.map((r) => {
    const factIds = lookup(c).evidence.get(r.evidenceId)?.lab?.resultFactIds ?? [];
    for (const f of factIds) if (!s.knownFacts.includes(f)) s.knownFacts.push(f);
    s.labs.find((l) => l.evidenceId === r.evidenceId)!.collected = true;
    return { evidenceId: r.evidenceId, factIds };
  });
  settle(c, s);
  s.updatedAt = now;
  return { state: s, results };
}
