import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeCaseJsonSchema } from '../scripts/export-schema.js';

describe('json schema export', () => {
  it('writes a json schema document for the case format', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'alibi-schema-')), 'case.schema.json');
    writeCaseJsonSchema(out);
    const schema = JSON.parse(readFileSync(out, 'utf8'));
    expect(schema.$schema).toMatch(/json-schema/);
    expect(schema.properties.solution.required).toContain('culprit');
  });
});
