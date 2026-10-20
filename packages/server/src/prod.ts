import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCase, type Case } from '@alibi/canon';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomId, type AssetStore, type Deps } from './deps.js';
import { createStepFunctionsDispatcher } from './custom/dispatch.js';
import type { AppConfig } from './http/app.js';
import { createEventBridgeScheduler } from './lab/scheduler.js';
import { createDynamoStores } from './store/dynamo.js';
import { demoProcessor } from './ucp/payment.js';

/** Every `<dir>/<case>/case.json`, parsed and cross-checked. */
export function loadCases(dir: string): Case[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'case.json')))
    .map((e) => parseCase(JSON.parse(readFileSync(join(dir, e.name, 'case.json'), 'utf8'))))
    .sort((a, b) => a.meta.priceCents - b.meta.priceCents || a.meta.title.localeCompare(b.meta.title));
}

/** Built single-file MCP App views, keyed by view name. */
export function loadViews(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => [f.slice(0, -5), readFileSync(join(dir, f), 'utf8')]),
  );
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  json: 'application/json',
};

/** Case art and voice clips from a private bucket, under a key prefix. */
export function createS3AssetStore(cfg: {
  bucket: string;
  prefix: string;
  client?: { send: (cmd: GetObjectCommand) => Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> }; ContentType?: string }> };
}): AssetStore {
  const client = cfg.client ?? (new S3Client({}) as unknown as NonNullable<typeof cfg.client>);
  return {
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: `${cfg.prefix}${key}` }));
        if (!res.Body) return null;
        const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
        return { body: await res.Body.transformToByteArray(), contentType: res.ContentType ?? CONTENT_TYPES[ext] ?? 'application/octet-stream' };
      } catch (err) {
        if ((err as Error).name === 'NoSuchKey' || (err as Error).name === 'NotFound') return null;
        throw err;
      }
    },
  };
}

type Env = Record<string, string | undefined>;

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`missing environment variable ${key}`);
  return v;
}

export function configFromEnv(env: Env, publicOrigin: string): AppConfig {
  return {
    mcpUrl: `${publicOrigin}/mcp`,
    issuer: required(env, 'ISSUER'),
    cognitoDomain: required(env, 'COGNITO_DOMAIN'),
    clientIds: list(env.CLIENT_IDS),
    corsOrigins: list(env.CORS_ORIGINS),
    // Payments are simulated end to end (see README); a real PSP client replaces this.
    payments: demoProcessor,
  };
}

export function depsFromEnv(env: Env, publicOrigin: string, cases: Case[], views: Record<string, string>): Deps {
  const stores = createDynamoStores({ table: required(env, 'TABLE'), bundled: cases });
  const stateMachineArn = env.STATE_MACHINE_ARN;
  return {
    ...stores,
    clock: Date.now,
    assetsBaseUrl: env.ASSETS_BASE_URL ?? `${publicOrigin}/assets`,
    dispatcher: stateMachineArn
      ? createStepFunctionsDispatcher({ stateMachineArn })
      : { enqueueCasegen: async (jobId) => console.warn(JSON.stringify({ event: 'casegen_disabled', jobId })) },
    scheduler: createEventBridgeScheduler({
      groupName: required(env, 'LAB_SCHEDULE_GROUP'),
      targetArn: required(env, 'LAB_TARGET_ARN'),
      roleArn: required(env, 'LAB_SCHEDULER_ROLE_ARN'),
    }),
    demoMode: env.DEMO_MODE === '1',
    appHtml: views,
    newId: randomId,
    ...(env.ASSETS_BUCKET ? { assetStore: createS3AssetStore({ bucket: env.ASSETS_BUCKET, prefix: env.ASSETS_PREFIX ?? 'assets/' }) } : {}),
  };
}
