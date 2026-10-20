import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildAll, DIST, PKG } from './build-all.js';
import { VIEW_NAMES } from '../src/lib/views.js';

/**
 * Builds every view and writes them into the server as APP_HTML, keyed by view
 * name, so the Lambda serves the bundles without reading files at runtime.
 * Pass --no-build to embed what is already in dist/.
 */
const REGISTRY = resolve(PKG, '../server/src/apps/registry.ts');
const TARGET = resolve(PKG, '../server/src/apps/generated.ts');

async function serverViews(): Promise<string[]> {
  const src = await readFile(REGISTRY, 'utf8');
  const list = /VIEWS\s*=\s*\[([^\]]*)\]/.exec(src)?.[1];
  if (!list) throw new Error(`could not find VIEWS in ${REGISTRY}`);
  return Array.from(list.matchAll(/'([^']+)'|"([^"]+)"/g), (m) => m[1] ?? m[2] ?? '');
}

if (!process.argv.includes('--no-build')) await buildAll();

const expected = await serverViews();
const missing = expected.filter((v) => !VIEW_NAMES.includes(v as never));
const extra = VIEW_NAMES.filter((v) => !expected.includes(v));
if (missing.length || extra.length) {
  throw new Error(`view list differs from the server registry. missing: [${missing.join(', ')}], extra: [${extra.join(', ')}]`);
}

const entries: string[] = [];
for (const name of expected) {
  const html = await readFile(resolve(DIST, `${name}.html`), 'utf8');
  entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(html)},`);
}

const body = [
  '// Built by `pnpm --filter @alibi/apps run embed` from packages/apps. Do not edit by hand.',
  'export const APP_HTML: Record<string, string> = {',
  ...entries,
  '};',
  '',
].join('\n');

await writeFile(TARGET, body, 'utf8');
console.log(`wrote ${expected.length} views to ${TARGET} (${(Buffer.byteLength(body) / 1024).toFixed(0)} kB)`);
