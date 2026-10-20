import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ask } from '../src/engine/ask.js';
import { demeanorFor } from '../src/engine/demeanor.js';
import { parseCase, type Case } from '../src/schema.js';
import { newGameState } from '../src/state.js';
import { tinyCase } from './helpers.js';

function cases(): Case[] {
  const out = [tinyCase()];
  const dir = fileURLToPath(new URL('../../../cases/', import.meta.url));
  if (existsSync(dir)) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name, 'case.json');
      if (e.isDirectory() && existsSync(f)) out.push(parseCase(JSON.parse(readFileSync(f, 'utf8'))));
    }
  }
  return out;
}

describe('demeanor never singles out the culprit', () => {
  for (const c of cases()) {
    it(`${c.meta.id}: every mood the culprit can show, someone innocent can show too`, () => {
      const seen = new Map<string, Set<string>>();
      for (const suspect of c.suspects) {
        for (const topic of c.topics) {
          let s = newGameState(c, 'g', null, 0);
          for (let i = 0; i < 3; i++) {
            s = ask(c, s, { suspectId: suspect.id, topicId: topic.id }, 0).state;
            const mood = demeanorFor(c, s, suspect.id);
            if (!seen.has(mood)) seen.set(mood, new Set());
            seen.get(mood)!.add(suspect.id);
          }
        }
      }
      for (const [mood, who] of seen) {
        expect(who.size === 1 && who.has(c.solution.culprit), `"${mood}" is only ever shown by the culprit`).toBe(false);
      }
    });
  }
});
