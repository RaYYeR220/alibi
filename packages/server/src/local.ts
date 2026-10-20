import { serve } from '@hono/node-server';
import { OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server';
import { randomId } from './deps.js';
import { createApp } from './http/app.js';
import { loadCases, loadViews } from './prod.js';
import { createMemoryStores } from './store/memory.js';
import { demoProcessor } from './ucp/payment.js';

/**
 * Local development server: in-memory stores, the real cases and views from
 * disk, and development tokens ("dev-service", "dev-user-<name>") instead of Cognito.
 */
const port = Number(process.env.PORT ?? 8787);
const origin = `http://localhost:${port}`;
const cases = loadCases(process.env.CASES_DIR ?? '../../cases');
const stores = createMemoryStores({ bundled: cases });

const devVerify = async (token: string): Promise<AuthInfo> => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  if (token === 'dev-service') return { token, clientId: 'dev', scopes: ['mcp:service'], expiresAt, extra: { tier: 'service' } };
  const user = /^dev-user-([a-z0-9-]+)$/.exec(token);
  if (user) return { token, clientId: 'dev', scopes: ['mcp:tools', 'mcp:resources'], expiresAt, extra: { tier: 'user', sub: user[1] } };
  throw new OAuthError(OAuthErrorCode.InvalidToken, 'unknown development token');
};

const app = createApp(
  {
    ...stores,
    clock: Date.now,
    assetsBaseUrl: `${origin}/assets`,
    dispatcher: { enqueueCasegen: async (jobId) => console.log(`casegen queued ${jobId}`) },
    scheduler: { schedule: async () => {} },
    demoMode: true,
    appHtml: loadViews(process.env.VIEWS_DIR ?? '../apps/dist'),
    newId: randomId,
  },
  {
    mcpUrl: `${origin}/mcp`,
    issuer: 'https://localhost/dev-issuer',
    cognitoDomain: 'https://localhost/dev-auth',
    clientIds: ['dev'],
    corsOrigins: ['http://localhost:5173'],
    payments: demoProcessor,
    verify: devVerify,
  },
);

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`Alibi MCP server on ${origin}/mcp (${cases.length} cases)`));
