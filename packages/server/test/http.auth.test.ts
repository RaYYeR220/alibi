import { describe, expect, it } from 'vitest';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { createApp } from '../src/http/app.js';
import { serviceAuth, testDeps, userAuth } from './harness.js';

const cfg = {
  mcpUrl: 'https://api.alibi.test/mcp',
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST',
  cognitoDomain: 'https://alibi.auth.us-east-1.amazoncognito.com',
  clientIds: ['service-client', 'household-client'],
  corsOrigins: ['https://play.alibi.test'],
  verify: async (token: string) => {
    if (token === 'service') return serviceAuth;
    if (token === 'alice') return userAuth('alice');
    throw new OAuthError(OAuthErrorCode.InvalidToken, 'bad token');
  },
};

const rpc = (body: object, token?: string) =>
  new Request('https://api.alibi.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
  });

const call = (name: string, args: object = {}) => ({ method: 'tools/call', params: { name, arguments: args } });

describe('http auth gate', () => {
  it('tier-2 tool with service token is 401 without WWW-Authenticate', async () => {
    const app = createApp(testDeps(), cfg);
    const res = await app.fetch(rpc(call('my_progress'), 'service'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('tier-2 tool with a household token passes', async () => {
    const app = createApp(testDeps(), cfg);
    const res = await app.fetch(rpc(call('my_progress'), 'alice'));
    expect(res.status).toBe(200);
  });

  it('tier-1 tool with service token is 200', async () => {
    const app = createApp(testDeps(), cfg);
    const res = await app.fetch(rpc(call('list_cases'), 'service'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Brooch at Ashby House');
  });

  it('invalid token is 401 without WWW-Authenticate', async () => {
    const app = createApp(testDeps(), cfg);
    const res = await app.fetch(rpc(call('list_cases'), 'forged'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('initialize works without a token for discovery', async () => {
    const app = createApp(testDeps(), cfg);
    const res = await app.fetch(
      rpc({ method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } }),
    );
    expect(res.status).toBe(200);
  });

  it('PRM document has resource and authorization_servers', async () => {
    const app = createApp(testDeps(), cfg);
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await app.fetch(new Request(`https://api.alibi.test${path}`));
      expect(res.status).toBe(200);
      const prm = await res.json();
      expect(prm).toMatchObject({ resource: cfg.mcpUrl, authorization_servers: [cfg.issuer], bearer_methods_supported: ['header'] });
    }
  });

  it('authorization server metadata points at the cognito endpoints', async () => {
    const app = createApp(testDeps(), cfg);
    const meta = await (await app.fetch(new Request('https://api.alibi.test/.well-known/oauth-authorization-server'))).json();
    expect(meta).toMatchObject({
      issuer: cfg.issuer,
      authorization_endpoint: `${cfg.cognitoDomain}/oauth2/authorize`,
      token_endpoint: `${cfg.cognitoDomain}/oauth2/token`,
      code_challenge_methods_supported: ['S256'],
    });
    expect(meta.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'client_credentials']));
  });

  it('CORS preflight from simulator origin is allowed', async () => {
    const app = createApp(testDeps(), cfg);
    const res = await app.fetch(
      new Request('https://api.alibi.test/mcp', {
        method: 'OPTIONS',
        headers: { origin: 'https://play.alibi.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,mcp-protocol-version' },
      }),
    );
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://play.alibi.test');
  });

  it('health check answers', async () => {
    const app = createApp(testDeps(), cfg);
    expect((await app.fetch(new Request('https://api.alibi.test/healthz'))).status).toBe(200);
  });
});
