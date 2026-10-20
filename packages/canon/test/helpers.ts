import { readFileSync } from 'node:fs';
import { parseCase, type Case } from '../src/schema.js';
import { newGameState, type GameState } from '../src/state.js';

export const rawTiny = () => JSON.parse(readFileSync(new URL('./fixtures/tiny-case.json', import.meta.url), 'utf8'));

export const tinyCase = (mutate?: (raw: any) => void): Case => {
  const raw = rawTiny();
  mutate?.(raw);
  return parseCase(raw);
};

export const fresh = (c: Case): GameState => newGameState(c, 'g-test', null, 0);

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}
