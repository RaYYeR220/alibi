import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Hono, type Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

interface File {
  body: Uint8Array;
  gz?: Uint8Array;
  type: string;
}

/** The built web app, held in memory: a handful of files, read once per cold start. */
export function loadSite(dir: string): Map<string, File> {
  const files = new Map<string, File>();
  if (!existsSync(dir)) return files;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const body = readFileSync(full);
      const type = TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
      const compressible = /^(text\/|application\/json|image\/svg)/.test(type) && body.length > 1024;
      files.set('/' + relative(dir, full).split('\\').join('/'), { body, type, ...(compressible ? { gz: gzipSync(body) } : {}) });
    }
  };
  walk(dir);
  return files;
}

function send(c: Context, file: File, cache: string): Response {
  const gzip = file.gz && /\bgzip\b/.test(c.req.header('accept-encoding') ?? '');
  const headers: Record<string, string> = {
    'content-type': file.type,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    vary: 'accept-encoding',
  };
  if (gzip) headers['content-encoding'] = 'gzip';
  return new Response((gzip ? file.gz! : file.body) as BodyInit, { headers });
}

/** Static routes: hashed assets cached for a year, pages always revalidated, app routes fall back to the shell. */
export function siteRoutes(files: Map<string, File>): Hono {
  const app = new Hono();
  app.get('*', (c) => {
    const path = c.req.path;
    const exact = files.get(path);
    if (exact) return send(c, exact, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    const page = files.get(`${path.replace(/\/$/, '')}.html`) ?? (extname(path) ? undefined : files.get('/index.html'));
    if (page) return send(c, page, 'no-cache');
    return c.text('Not found', 404);
  });
  return app;
}

/**
 * The sandbox origin: one page, embeddable only by the simulator, with the
 * simulator's origin written into its relay so it never talks to anyone else.
 */
export function sandboxRoutes(html: string, hostOrigins: string[]): Hono {
  const page = html.replace('/*HOST_ORIGINS*/ []', JSON.stringify(hostOrigins));
  const app = new Hono();
  app.get('*', (c) => {
    if (c.req.path !== '/' && c.req.path !== '/sandbox.html') return c.text('Not found', 404);
    return c.body(page, 200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'content-security-policy': `frame-ancestors ${hostOrigins.join(' ')}`,
      'x-content-type-options': 'nosniff',
    });
  });
  return app;
}
