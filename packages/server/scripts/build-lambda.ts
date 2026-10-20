/**
 * Bundles the Lambda functions into dist-lambda/: index.mjs (MCP + UCP API),
 * lab.mjs (lab-ready notifier), plus the case files and built MCP App views
 * they load at cold start.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { VIEWS } from '../src/apps/registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const root = resolve(pkg, '..', '..');
const out = join(pkg, 'dist-lambda');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { index: join(pkg, 'src', 'lambda.ts'), lab: join(pkg, 'src', 'lambda-lab.ts') },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outdir: out,
  outExtension: { '.js': '.mjs' },
  external: ['@aws-sdk/*'],
  banner: { js: "import { createRequire as __alibiRequire } from 'module'; const require = __alibiRequire(import.meta.url);" },
  logLevel: 'warning',
});

const casesDir = join(root, 'cases');
const caseIds = existsSync(casesDir)
  ? readdirSync(casesDir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(casesDir, e.name, 'case.json'))).map((e) => e.name)
  : [];
for (const id of caseIds) {
  mkdirSync(join(out, 'cases', id), { recursive: true });
  copyFileSync(join(casesDir, id, 'case.json'), join(out, 'cases', id, 'case.json'));
}
if (caseIds.length === 0) {
  console.warn('no cases/ found; bundling the test fixture so the endpoint has something to serve');
  mkdirSync(join(out, 'cases', 'tiny-brooch'), { recursive: true });
  copyFileSync(join(root, 'packages', 'canon', 'test', 'fixtures', 'tiny-case.json'), join(out, 'cases', 'tiny-brooch', 'case.json'));
}

const viewsDir = join(root, 'packages', 'apps', 'dist');
mkdirSync(join(out, 'views'), { recursive: true });
const views = existsSync(viewsDir) ? readdirSync(viewsDir).filter((f) => f.endsWith('.html')) : [];
// Without the built views the server falls back to empty placeholder pages, so every card renders blank.
const missing = VIEWS.filter((v) => !views.includes(`${v}.html`));
if (missing.length) throw new Error(`missing built views (${missing.join(', ')}): run pnpm --filter @alibi/apps build`);
for (const f of views) copyFileSync(join(viewsDir, f), join(out, 'views', f));

console.log(`dist-lambda: ${caseIds.length || 1} case(s), ${views.length} view(s)`);
