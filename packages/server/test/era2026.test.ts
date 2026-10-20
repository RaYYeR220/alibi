import { describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ProgressView } from '@alibi/canon';
import { buildServer } from '../src/mcp/build-server.js';
import { createAlibiMcpHandler } from '../src/mcp/handler.js';
import { testDeps, text, userAuth, view } from './harness.js';

async function modernClient(deps: ReturnType<typeof testDeps>, opts: { elicit?: (msg: string) => Record<string, unknown> } = {}) {
  const authInfo = userAuth('okafor');
  const handler = createAlibiMcpHandler(({ authInfo: a, era }) => buildServer(deps, { authInfo: a, era }));
  const fetchFn = (input: string | URL | Request, init?: RequestInit) =>
    handler.fetch(input instanceof Request ? input : new Request(input, init), { authInfo });
  const client = new Client(
    { name: 'modern-host', version: '1.0.0' },
    { capabilities: opts.elicit ? { elicitation: { form: {} } } : {}, versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  if (opts.elicit) {
    const answer = opts.elicit;
    client.setRequestHandler('elicitation/create', async (req) => ({ action: 'accept', content: answer((req.params as { message: string }).message) }));
  }
  await client.connect(new StreamableHTTPClientTransport(new URL('http://alibi.test/mcp'), { fetch: fetchFn }));
  return client;
}

describe('2026-07-28 era', () => {
  it('server/discover lists tools and resources capability', async () => {
    const client = await modernClient(testDeps());
    expect(client.getProtocolEra()).toBe('modern');
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.resources).toBeDefined();
  });

  it('create_custom_case without names returns input_required in 2026 era and completes on retry with inputResponses', async () => {
    const deps = testDeps();
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    const asked: string[] = [];
    const client = await modernClient(deps, {
      elicit: (message) => {
        asked.push(message);
        return { names: 'Ada, Tunde, Chioma', occasion: "Grandma Ada's 80th" };
      },
    });
    const r = await client.callTool({ name: 'create_custom_case', arguments: { names: [] } });
    expect(asked).toEqual([expect.stringMatching(/who should be in it/i)]);
    const v = view<ProgressView>(r);
    expect(v.jobs[0]).toMatchObject({ status: 'queued' });
    expect(await deps.jobs.get(v.jobs[0]!.jobId)).toMatchObject({ input: expect.objectContaining({ names: ['Ada', 'Tunde', 'Chioma'] }) });
  });

  it('a 2026 client without elicitation gets the question as text', async () => {
    const deps = testDeps();
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    const client = await modernClient(deps);
    const r = await client.callTool({ name: 'create_custom_case', arguments: { names: [] } });
    expect(text(r)).toMatch(/who should be in it/i);
  });

  // The 2.3.1 SDK exposes no server API for the io.modelcontextprotocol/tasks extension yet;
  // long jobs are reported through check_custom_case, my_progress and the household inbox instead.
  it.skip('create_custom_case returns a task handle when the client negotiates io.modelcontextprotocol/tasks', () => {});
});
