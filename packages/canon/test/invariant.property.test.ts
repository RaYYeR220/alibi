import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { playArb, playSequence, trulySealed } from '../src/redteam.js';
import { parseCase, type Case } from '../src/schema.js';

function loadCases(): { name: string; c: Case }[] {
  const out = [{ name: 'tiny-case', c: parseCase(JSON.parse(readFileSync(new URL('./fixtures/tiny-case.json', import.meta.url), 'utf8'))) }];
  const dir = new URL('../../../cases/', import.meta.url);
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1'), entry.name, 'case.json');
      if (entry.isDirectory() && existsSync(file)) out.push({ name: entry.name, c: parseCase(JSON.parse(readFileSync(file, 'utf8'))) });
    }
  }
  return out;
}

describe('invariant I1: nothing unearned is ever said', () => {
  for (const { name, c } of loadCases()) {
    it(`${name}: every response passes the guard over random play`, () => {
      const sealed = trulySealed(c);
      fc.assert(
        fc.property(playArb(c), (actions) => {
          expect(playSequence(c, actions, 0, sealed).violations).toEqual([]);
        }),
        { numRuns: 2000 },
      );
    }, 180_000);
  }
});
