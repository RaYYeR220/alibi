import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configFromEnv, loadCases, loadViews } from '../src/prod.js';
import { tinyCase } from './harness.js';

describe('production wiring', () => {
  it('loads every case.json under the cases directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alibi-cases-'));
    mkdirSync(join(dir, 'tiny-brooch'));
    writeFileSync(join(dir, 'tiny-brooch', 'case.json'), JSON.stringify(tinyCase));
    mkdirSync(join(dir, 'not-a-case'));
    expect(loadCases(dir).map((c) => c.meta.id)).toEqual(['tiny-brooch']);
  });

  it('loads built view html by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alibi-views-'));
    writeFileSync(join(dir, 'board.html'), '<!doctype html><p>board</p>');
    expect(loadViews(dir)).toEqual({ board: '<!doctype html><p>board</p>' });
    expect(loadViews(join(dir, 'missing'))).toEqual({});
  });

  it('reads the app config from the environment', () => {
    const cfg = configFromEnv(
      {
        ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/pool',
        COGNITO_DOMAIN: 'https://alibi.auth.us-east-1.amazoncognito.com',
        CLIENT_IDS: 'a,b',
        CORS_ORIGINS: 'https://play.example',
      },
      'https://d123.cloudfront.net',
    );
    expect(cfg).toMatchObject({
      mcpUrl: 'https://d123.cloudfront.net/mcp',
      clientIds: ['a', 'b'],
      corsOrigins: ['https://play.example'],
    });
  });
});

describe('s3 asset store', () => {
  it('reads objects under the assets prefix with their content type', async () => {
    const { createS3AssetStore } = await import('../src/prod.js');
    const seen: any[] = [];
    const store = createS3AssetStore({
      bucket: 'b',
      prefix: 'assets/',
      client: {
        send: async (cmd: any) => {
          seen.push(cmd.input);
          if (cmd.input.Key === 'assets/cases/x/a.mp3') return { Body: { transformToByteArray: async () => new Uint8Array([1, 2]) }, ContentType: undefined };
          const err = new Error('NoSuchKey');
          err.name = 'NoSuchKey';
          throw err;
        },
      },
    });
    const hit = await store.get('cases/x/a.mp3');
    expect(hit?.contentType).toBe('audio/mpeg');
    expect(Array.from(hit!.body as Uint8Array)).toEqual([1, 2]);
    expect(seen[0]).toEqual({ Bucket: 'b', Key: 'assets/cases/x/a.mp3' });
    expect(await store.get('cases/x/missing.png')).toBeNull();
  });
});
