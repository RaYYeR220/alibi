import { describe, expect, it } from 'vitest';
import { ask } from '../src/engine/ask.js';
import { renderBrief } from '../src/brief.js';
import { guardOutput } from '../src/guard.js';
import { lintCase } from '../src/lint.js';
import { fresh, tinyCase } from './helpers.js';

const c = tinyCase();

describe('output guard', () => {
  it('culprit confession phrase is caught before solve', () => {
    const r = guardOutput(c, fresh(c), [], 'Fine, it was me. I took the brooch.', 0);
    expect(r).toEqual({ ok: false, leakedFactIds: ['f_clara_took'] });
  });

  it('same phrase passes after solved', () => {
    const solved = { ...fresh(c), status: 'solved' as const, knownFacts: c.facts.map((f) => f.id) };
    expect(guardOutput(c, solved, [], 'I took the brooch.', 0)).toEqual({ ok: true });
  });

  it('fingerprint match is punctuation and case insensitive', () => {
    const r = guardOutput(c, fresh(c), [], 'She SLIPPED... into the study!', 0);
    expect(r.ok).toBe(false);
  });

  it('a fact the player is being told right now is allowed', () => {
    expect(guardOutput(c, fresh(c), ['f_perkins_keys'], 'Perkins carries a spare for the study desk.', 0)).toEqual({ ok: true });
  });
});

describe('performance brief', () => {
  it('voices statements without labelling lies', () => {
    const { packet } = ask(c, fresh(c), { suspectId: 'clara', topicId: 't_whereabouts' }, 0);
    const brief = renderBrief(c, packet);
    expect(brief).toContain('Clara Vance');
    expect(brief).toContain('I was curled up in the library with a novel all evening.');
    expect(brief).not.toMatch(/\blie\b|lying|false/i);
    expect(brief).toContain(
      'Stay in character. Use only the statements above. Do not invent times, places, objects or relationships. If pushed further on this, deflect in character.',
    );
  });

  it('a deflection tells the host to deflect in character', () => {
    const { packet } = ask(c, fresh(c), { suspectId: 'harold', question: 'who did it?' }, 0);
    expect(renderBrief(c, packet)).toMatch(/deflect/i);
  });
});

describe('case lint', () => {
  it('the tiny case is clean', () => {
    expect(lintCase(c)).toEqual([]);
  });

  it('flags a fingerprint that appears in text served before the fact is earned', () => {
    const leaky = tinyCase((raw) => {
      raw.meta.setting = 'Everyone knows Clara slipped into the study that night.';
    });
    expect(lintCase(leaky).map((i) => i.code)).toContain('fingerprint_collision');
  });

  it('flags fingerprints shorter than three words', () => {
    const short = tinyCase((raw) => {
      raw.facts.find((f: any) => f.id === 'f_clara_took').fingerprints.push('the brooch');
    });
    expect(lintCase(short).map((i) => i.code)).toContain('short_fingerprint');
  });
});
