import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CaseFormatError, parseCase } from '../src/schema.js';

const tiny = () => JSON.parse(readFileSync(new URL('./fixtures/tiny-case.json', import.meta.url), 'utf8'));

describe('case schema', () => {
  it('tiny-case parses', () => {
    const c = parseCase(tiny());
    expect(c.suspects).toHaveLength(3);
    expect(c.lies).toHaveLength(2);
    expect(c.evidence.filter((e) => e.lab)).toHaveLength(1);
    expect(c.solution.culprit).toBe('clara');
  });

  it('dangling factId is rejected with path', () => {
    const raw = tiny();
    raw.knowledge[2].factId = 'f_nope';
    expect(() => parseCase(raw)).toThrow(CaseFormatError);
    expect(() => parseCase(raw)).toThrow(/knowledge\[2\]\.factId/);
  });

  it('knowledge on a fact without fingerprints for motive/means/opportunity is rejected', () => {
    const raw = tiny();
    const debts = raw.facts.find((f: { id: string }) => f.id === 'f_clara_debts');
    debts.fingerprints = [];
    expect(() => parseCase(raw)).toThrow(/facts\[\d+\]\.fingerprints/);
  });
});
