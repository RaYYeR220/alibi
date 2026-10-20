import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadSite, sandboxRoutes, siteRoutes } from '../site.js';

const here = dirname(fileURLToPath(import.meta.url));
const sandboxHtml = readFileSync(join(here, '..', '..', 'sandbox', 'sandbox.html'), 'utf8');

function site() {
  const dir = mkdtempSync(join(tmpdir(), 'sim-site-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><p>shell</p>');
  writeFileSync(join(dir, 'callback.html'), '<!doctype html><p>callback</p>');
  writeFileSync(join(dir, 'assets', 'app-1a2b.js'), `console.log(${JSON.stringify('x'.repeat(4000))});`);
  return siteRoutes(loadSite(dir));
}

describe('static site', () => {
  it('serves hashed assets for a year, gzipped when asked', async () => {
    const res = await site().fetch(new Request('https://sim.test/assets/app-1a2b.js', { headers: { 'accept-encoding': 'gzip, br' } }));
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toContain('console.log');
  });

  it('serves the sign-in callback page and falls back to the shell', async () => {
    const app = site();
    expect(await (await app.fetch(new Request('https://sim.test/callback?code=abc'))).text()).toContain('callback');
    expect(await (await app.fetch(new Request('https://sim.test/'))).text()).toContain('shell');
    expect((await app.fetch(new Request('https://sim.test/missing.png'))).status).toBe(404);
  });
});

describe('sandbox origin', () => {
  it('can only be framed by the simulator and relays only to it', async () => {
    const app = sandboxRoutes(sandboxHtml, ['https://sim.test']);
    const res = await app.fetch(new Request('https://sandbox.test/'));
    expect(res.headers.get('content-security-policy')).toBe('frame-ancestors https://sim.test');
    const html = await res.text();
    expect(html).toContain('const HOSTS = ["https://sim.test"]');
    expect(html).toContain('ui/notifications/sandbox-');
    expect((await app.fetch(new Request('https://sandbox.test/api/llm'))).status).toBe(404);
  });
});
