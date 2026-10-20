import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createCognitoVerifier } from '../auth/verifier.js';
import type { Deps } from '../deps.js';
import { buildServer } from '../mcp/build-server.js';
import { createAlibiMcpHandler } from '../mcp/handler.js';
import { gate, type Verify } from './gate.js';
import { authorizationServerMetadata, protectedResourceMetadata } from './wellknown.js';

export interface AppConfig {
  mcpUrl: string;
  issuer: string;
  cognitoDomain: string;
  clientIds: string[];
  corsOrigins: string[];
  /** Injected in tests; defaults to the Cognito JWKS verifier. */
  verify?: Verify;
}

const MCP_HEADERS = ['authorization', 'content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'];

export function createApp(deps: Deps, cfg: AppConfig): Hono {
  const verify = cfg.verify ?? createCognitoVerifier({ issuer: cfg.issuer, clientIds: cfg.clientIds });
  const handler = createAlibiMcpHandler(({ authInfo }) => buildServer(deps, { authInfo }));
  const app = new Hono();

  app.use(
    '/mcp',
    cors({
      origin: cfg.corsOrigins,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: MCP_HEADERS,
      exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
      maxAge: 600,
    }),
  );

  app.all('/mcp', async (c) => {
    const req = c.req.raw;
    const raw = req.method === 'POST' ? await req.text() : undefined;
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    const decision = await gate(req, body, verify);
    if (decision instanceof Response) return decision;
    const forwarded = new Request(req.url, { method: req.method, headers: req.headers, body: raw });
    return handler.fetch(forwarded, { authInfo: decision.authInfo });
  });

  const prm = () => protectedResourceMetadata(cfg);
  app.get('/.well-known/oauth-protected-resource', (c) => c.json(prm()));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(prm()));
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(authorizationServerMetadata(cfg)));
  app.get('/healthz', (c) => c.json({ ok: true }));

  return app;
}
