import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { CaseSchema } from '../src/schema.js';

/** Writes the case format as JSON Schema; the Python pipeline generates its models from it. */
export function writeCaseJsonSchema(outFile: string): void {
  const schema = z.toJSONSchema(CaseSchema, { io: 'input' });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(schema, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'case.schema.json');
  writeCaseJsonSchema(out);
  console.log(`wrote ${out}`);
}
