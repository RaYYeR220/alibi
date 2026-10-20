import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { createAlibiMcpHandler } from '../src/mcp/handler.js';

const PING_URI = 'ui://alibi/ping.html';

function pingServer(): McpServer {
  const server = new McpServer({ name: 'alibi-test', version: '0.0.0' });
  registerAppTool(
    server,
    'ping',
    {
      description: 'Answers pong',
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri: PING_URI } },
    },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  );
  registerAppResource(server, PING_URI, PING_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: PING_URI, mimeType: RESOURCE_MIME_TYPE, text: '<!doctype html><p>ping</p>' }],
  }));
  return server;
}

const handler = createAlibiMcpHandler(() => pingServer());
const URL_MCP = 'http://alibi.test/mcp';
const inProcessFetch = (input: string | URL | Request, init?: RequestInit) =>
  handler.fetch(input instanceof Request ? input : new Request(input, init));

async function readJsonRpc(res: Response): Promise<any> {
  const type = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (type.includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .pop();
    return JSON.parse(data ?? 'null');
  }
  return JSON.parse(text);
}

describe('dual-era MCP handler', () => {
  it('initialize with protocolVersion 2025-03-26 is accepted', async () => {
    const res = await handler.fetch(
      new Request(URL_MCP, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: { roots: { listChanged: true } },
            clientInfo: { name: 'Alexa+ MCP Client', version: '1.0' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJsonRpc(res);
    expect(['2025-03-26', '2025-11-25']).toContain(body.result.protocolVersion);
  });

  it('2025-11-25 client lists tools and reads ui resource', async () => {
    const client = new Client({ name: 'legacy', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(URL_MCP), { fetch: inProcessFetch }));
    expect(client.getProtocolEra()).toBe('legacy');
    const { tools } = await client.listTools();
    const ping = tools.find((t) => t.name === 'ping');
    expect(ping?._meta?.ui).toMatchObject({ resourceUri: PING_URI });
    const resource = await client.readResource({ uri: PING_URI });
    expect(resource.contents[0]?.mimeType).toBe(RESOURCE_MIME_TYPE);
    await client.close();
  });

  it('2026-07-28 client calls ping statelessly', async () => {
    const client = new Client(
      { name: 'modern', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(URL_MCP), { fetch: inProcessFetch }));
    expect(client.getProtocolEra()).toBe('modern');
    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
    await client.close();
  });
});
