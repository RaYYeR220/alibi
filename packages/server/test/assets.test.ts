import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { demoProcessor } from '../src/ucp/payment.js';
import { testDeps } from './harness.js';

const cfg = {
  mcpUrl: 'https://api.alibi.test/mcp',
  issuer: 'https://issuer.test',
  cognitoDomain: 'https://auth.test',
  clientIds: [],
  corsOrigins: [],
  payments: demoProcessor,
};

describe('asset route', () => {
  it('serves case art with a content type and long cache', async () => {
    const files: Record<string, string> = { 'cases/tiny-brooch/harold.png': 'PNGDATA' };
    const app = createApp(
      testDeps({ assetStore: { get: async (key: string) => (key in files ? { body: new TextEncoder().encode(files[key]), contentType: 'image/png' } : null) } }),
      cfg,
    );
    const res = await app.fetch(new Request('https://api.alibi.test/assets/cases/tiny-brooch/harold.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe('PNGDATA');
  });

  it('returns 404 for missing files and refuses path traversal', async () => {
    const app = createApp(testDeps({ assetStore: { get: async () => null } }), cfg);
    expect((await app.fetch(new Request('https://api.alibi.test/assets/cases/nope.png'))).status).toBe(404);
    expect((await app.fetch(new Request('https://api.alibi.test/assets/..%2F..%2Fsecret'))).status).toBe(404);
  });
});
