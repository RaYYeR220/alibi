import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { Case } from '@alibi/canon';
import type { Deps } from '../src/deps.js';
import { buildServer } from '../src/mcp/build-server.js';
import { createAlibiMcpHandler } from '../src/mcp/handler.js';
import { createMemoryStores } from '../src/store/memory.js';
import { tinyCase } from './store.contract.js';

export { tinyCase };

let n = 0;

export function testDeps(overrides: Partial<Deps> = {}, cases: Case[] = [tinyCase]): Deps & { clock: () => number; tick: (ms: number) => void } {
  let now = Date.UTC(2026, 9, 20, 20);
  const stores = createMemoryStores({ bundled: cases, clock: () => now });
  const deps = {
    ...stores,
    clock: () => now,
    tick: (ms: number) => {
      now += ms;
    },
    assetsBaseUrl: 'https://assets.alibi.test',
    dispatcher: { enqueueCasegen: async () => {} },
    scheduler: { schedule: async () => {} },
    demoMode: false,
    appHtml: {},
    newId: (prefix: string) => `${prefix}_${(n++).toString(36).padStart(6, '0')}`,
    ...overrides,
  };
  return deps;
}

export const userAuth = (sub: string): AuthInfo => ({
  token: `tok-${sub}`,
  clientId: 'household-client',
  scopes: ['mcp:tools', 'mcp:resources'],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  extra: { tier: 'user', sub },
});

export const serviceAuth: AuthInfo = {
  token: 'tok-service',
  clientId: 'service-client',
  scopes: ['mcp:service'],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  extra: { tier: 'service' },
};

export async function connect(deps: Deps, authInfo: AuthInfo = serviceAuth): Promise<Client> {
  const handler = createAlibiMcpHandler(({ authInfo: a }) => buildServer(deps, { authInfo: a }));
  const fetchFn = (input: string | URL | Request, init?: RequestInit) =>
    handler.fetch(input instanceof Request ? input : new Request(input, init), { authInfo });
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://alibi.test/mcp'), { fetch: fetchFn }));
  return client;
}

export const text = (r: { content?: unknown }) =>
  ((r.content as { type: string; text?: string }[] | undefined) ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

export const view = <T = any>(r: { structuredContent?: unknown }) => r.structuredContent as T;
