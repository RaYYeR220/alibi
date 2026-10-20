import type { Case, Fact } from './schema.js';
import type { GameState } from './state.js';
import { lookup } from './engine/lookup.js';

/** Lowercase, punctuation stripped, whitespace collapsed: the form fingerprints are matched in. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function fingerprints(f: Fact): string[] {
  return [f.text, ...f.fingerprints].map(normalizeForMatch).filter(Boolean);
}

/**
 * Facts that must not appear in output right now: everything the player has
 * not earned and is not being told in this very response.
 */
export function forbiddenFactIds(c: Case, s: GameState, allowedNow: string[]): string[] {
  const ok = new Set([...s.knownFacts, ...allowedNow]);
  return c.facts.filter((f) => !ok.has(f.id)).map((f) => f.id);
}

export type GuardResult = { ok: true } | { ok: false; leakedFactIds: string[] };

/** Fail-closed check of a serialized tool response against every fact the player has not earned. */
export function guardOutput(c: Case, s: GameState, allowedNow: string[], serialized: string, _now: number): GuardResult {
  const haystack = ` ${normalizeForMatch(serialized)} `;
  const l = lookup(c);
  const leakedFactIds = forbiddenFactIds(c, s, allowedNow).filter((id) =>
    fingerprints(l.fact.get(id)!).some((fp) => haystack.includes(` ${fp} `)),
  );
  return leakedFactIds.length ? { ok: false, leakedFactIds } : { ok: true };
}
