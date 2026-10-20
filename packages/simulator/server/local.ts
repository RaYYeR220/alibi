/**
 * Local backend for `pnpm dev`: the same routes as the Lambda, on :8787 for
 * the API (Vite proxies /api) and :5174 for the sandbox origin.
 *   VENICE_API_KEY=... AWS_PROFILE=... tsx server/local.ts
 */
import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createSimApp } from './app.js';
import { cognitoClientSecret, cognitoVisitors, pollySpeech, serviceTokens, veniceChat } from './aws.js';
import { configFromEnv } from './config.js';
import { dynamoCounters, memoryCounters } from './counters.js';
import { sandboxRoutes } from './site.js';

const env = process.env;
const apiOrigin = env.API_ORIGIN ?? 'http://localhost:8080';
const cognitoDomain = env.COGNITO_DOMAIN ?? 'https://alibi-casefile.auth.us-east-1.amazoncognito.com';
const userPoolId = env.USER_POOL_ID ?? 'us-east-1_iNscKVSzb';
const serviceClientId = env.SERVICE_CLIENT_ID ?? '19ugi1kcr8idiu86diodbd9abs';

const app = createSimApp({
  counters: env.TABLE ? dynamoCounters(env.TABLE) : memoryCounters(),
  clock: Date.now,
  config: configFromEnv(env),
  venice: veniceChat({ key: { get: async () => env.VENICE_API_KEY ?? '', forget: () => {} } }),
  polly: pollySpeech(),
  visitors: cognitoVisitors({ userPoolId }),
  serviceToken: serviceTokens({ cognitoDomain, clientId: serviceClientId, secret: cognitoClientSecret({ userPoolId, clientId: serviceClientId }) }),
  publicConfig: async () => ({
    mcpUrl: `${apiOrigin}/mcp`,
    ucpBase: `${apiOrigin}/ucp`,
    cognitoDomain,
    clientId: env.SIM_CLIENT_ID ?? '5gatu3t885ojmpd172vmn82hpl',
    sandboxOrigin: 'http://localhost:5174',
  }),
  merchant: (path, init) => fetch(`${apiOrigin}/ucp${path}`, init),
  ipOf: (req) => req.headers.get('x-forwarded-for') ?? '127.0.0.1',
});

serve({ fetch: app.fetch, port: 8787 });
const sandboxHtml = readFileSync(new URL('../sandbox/sandbox.html', import.meta.url), 'utf8');
serve({ fetch: sandboxRoutes(sandboxHtml, ['http://localhost:5173']).fetch, port: 5174 });
console.log('simulator api on http://localhost:8787, sandbox on http://localhost:5174');
