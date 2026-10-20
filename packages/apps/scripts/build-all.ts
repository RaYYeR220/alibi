import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { VIEW_NAMES } from '../src/lib/views.js';

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = resolve(PKG, 'dist');

/** Builds one self-contained HTML file from an entry page. */
export async function buildPage(entryDir: string, outFile: string): Promise<void> {
  const tmp = resolve(DIST, '.tmp', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  await build({
    configFile: resolve(PKG, 'vite.config.ts'),
    root: entryDir,
    build: { outDir: tmp, emptyOutDir: true, rollupOptions: { input: resolve(entryDir, 'index.html') } },
  });
  await mkdir(dirname(outFile), { recursive: true });
  await copyFile(resolve(tmp, 'index.html'), outFile);
  await rm(tmp, { recursive: true, force: true });
}

/** Builds dist/<view>.html for every view. */
export async function buildAll(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of VIEW_NAMES) {
    const file = resolve(DIST, `${name}.html`);
    await buildPage(resolve(PKG, 'src/views', name), file);
    out[name] = file;
    const { size } = await stat(file);
    console.log(`${name.padEnd(14)} ${(size / 1024).toFixed(0).padStart(5)} kB`);
  }
  await rm(resolve(DIST, '.tmp'), { recursive: true, force: true });
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildAll();
}
