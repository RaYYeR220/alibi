import { describe, expect, it } from 'vitest';
import { parseCase } from '@alibi/canon';
import { readFileSync } from 'node:fs';
import { evidenceLockedFacts, latestRuns, lockedLeaks, sealedFacts, unearnedLeaks, wilson } from '../src/judge.js';

const c = parseCase(JSON.parse(readFileSync(new URL('../../packages/canon/test/fixtures/tiny-case.json', import.meta.url), 'utf8')));

describe('judge', () => {
  it('spoiler detects culprit confession phrase', () => {
    expect(unearnedLeaks(c, 'Fine. I took the brooch, and I would do it again.', ['f_dinner'])).toContain('f_clara_took');
  });

  it('spoiler ignores facts earned before that turn', () => {
    const known = ['f_dinner', 'f_brooch_gone', 'f_clara_study'];
    expect(unearnedLeaks(c, 'I slipped into the study at a quarter past nine, I admit it.', known)).toEqual([]);
    expect(unearnedLeaks(c, 'I slipped into the study at a quarter past nine, I admit it.', ['f_dinner'])).toEqual(['f_clara_study']);
  });

  it('sealed facts are the ones nobody may volunteer', () => {
    expect(sealedFacts(c)).toEqual(['f_clara_took']);
  });

  it('evidence-locked facts are the ones talking alone can never earn', () => {
    expect(evidenceLockedFacts(c).sort()).toEqual(['f_clara_study', 'f_clara_took', 'f_harold_twine', 'f_key_perfume']);
  });

  it('locked leaks ignore what the player said first and leave the culprit to the judge', () => {
    const known = ['f_dinner'];
    expect(lockedLeaks(c, 'She has nothing to say about who took the brooch.', known, ['Who took the brooch?'])).toEqual([]);
    expect(lockedLeaks(c, 'At a quarter past nine? I was reading.', known, ['Someone saw you at a quarter past nine.'])).toEqual([]);
    expect(lockedLeaks(c, 'Fine, I slipped into the study, all right?', known, ['Where were you?'])).toEqual(['f_clara_study']);
  });

  it('wilson interval brackets the observed rate', () => {
    const { low, high } = wilson(0, 300);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0.005);
    expect(high).toBeLessThan(0.02);
    const mid = wilson(30, 100);
    expect(mid.low).toBeLessThan(0.3);
    expect(mid.high).toBeGreaterThan(0.3);
  });
});

describe('latestRuns', () => {
  it('keeps one record per run, the last one written', () => {
    const rows = [
      { run: 0, v: 'old' },
      { run: 1, v: 'only' },
      { run: 0, v: 'new' },
    ];
    expect(latestRuns(rows)).toEqual([
      { run: 0, v: 'new' },
      { run: 1, v: 'only' },
    ]);
  });
});
