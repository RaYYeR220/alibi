import { describe, expect, it } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { createApp } from '../../server/src/http/app.js';
import { demoProcessor } from '../../server/src/ucp/payment.js';
import { serviceAuth, testDeps, userAuth } from '../../server/test/harness.js';
import { createHost } from '../src/agent.js';
import type { ChatMessage, LlmClient, LlmRequest } from '../src/llm.js';
import { connectMcp } from '../src/mcp.js';

/** Serves the real Alibi app in-process; tokens "service" and "user-<sub>" map to test identities. */
function inProcess(deps = testDeps()) {
  const app = createApp(deps, {
    mcpUrl: 'https://api.alibi.test/mcp',
    issuer: 'https://issuer.test',
    cognitoDomain: 'https://auth.test',
    clientIds: [],
    corsOrigins: [],
    payments: demoProcessor,
    verify: async (token: string): Promise<AuthInfo> => (token.startsWith('user-') ? userAuth(token.slice(5)) : serviceAuth),
  });
  return { deps, fetch: (input: string | URL | Request, init?: RequestInit) => app.fetch(input instanceof Request ? input : new Request(input, init)) };
}

/** An LLM that plays back a script: each entry decides the next assistant message from what it has seen. */
function scripted(steps: ((req: LlmRequest) => ChatMessage)[]): LlmClient & { seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];
  let i = 0;
  return {
    seen,
    async chat(req) {
      seen.push(structuredClone(req));
      const step = steps[Math.min(i++, steps.length - 1)]!;
      return { message: step(req), usage: { inTok: 10, outTok: 5 } };
    },
  };
}

const call = (name: string, args: object, id = `call_${name}`): ChatMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const speak = (content: string): ChatMessage => ({ role: 'assistant', content });

describe('host agent', () => {
  it('host passes game_id from start_case into ask_suspect', async () => {
    const { fetch } = inProcess();
    const mcp = await connectMcp({ url: 'https://api.alibi.test/mcp', getToken: async () => 'service', fetch });
    const llm = scripted([
      () => call('start_case', { case_id: 'tiny-brooch' }),
      () => speak('Welcome to Ashby House.'),
      () => call('ask_suspect', { suspect: 'Clara', question: 'Where were you at nine?' }),
      () => speak('I was in the library, darling.'),
    ]);
    const host = createHost({ llm, mcp, model: 'test-model' });
    await host.turn('Open the brooch case');
    const turn = await host.turn('Ask Clara where she was at nine');
    expect(turn.toolCalls.map((t) => t.name)).toEqual(['ask_suspect']);
    expect(turn.toolCalls[0]!.args).toMatchObject({ game_id: expect.stringMatching(/^g_/) });
    expect(turn.toolCalls[0]!.status).toBe('ok');
    expect(turn.speech).toBe('I was in the library, darling.');
    const lastToolMessage = llm.seen.at(-1)!.messages.filter((m) => m.role === 'tool').at(-1)!;
    expect(lastToolMessage.content).toContain('library');
  });

  it('401 on user-tier tool yields needsLinking', async () => {
    const { fetch } = inProcess();
    const mcp = await connectMcp({ url: 'https://api.alibi.test/mcp', getToken: async () => 'service', fetch });
    const llm = scripted([() => call('my_progress', {}), () => speak('unused')]);
    const turn = await createHost({ llm, mcp, model: 'm' }).turn("What's my progress?");
    expect(turn.needsLinking).toBe(true);
    expect(turn.speech).toMatch(/link your Alibi account/i);
  });

  it('ui resource html is attached when tool has resourceUri', async () => {
    const { fetch } = inProcess(testDeps({ appHtml: { 'case-intro': '<!doctype html><p>intro view</p>' } }));
    const mcp = await connectMcp({ url: 'https://api.alibi.test/mcp', getToken: async () => 'service', fetch });
    const llm = scripted([() => call('start_case', { case_id: 'tiny-brooch' }), () => speak('Here we go.')]);
    const turn = await createHost({ llm, mcp, model: 'm' }).turn('Start the case');
    expect(turn.ui).toHaveLength(1);
    expect(turn.ui[0]).toMatchObject({ resourceUri: 'ui://alibi/case-intro.html', html: '<!doctype html><p>intro view</p>' });
    expect((turn.ui[0]!.toolResult as { structuredContent: { kind: string } }).structuredContent.kind).toBe('case-intro');
  });

  it('records protocol traffic with timings', async () => {
    const { fetch } = inProcess();
    const traffic: { method: string; ms: number; status: number }[] = [];
    const mcp = await connectMcp({ url: 'https://api.alibi.test/mcp', getToken: async () => 'service', fetch, onTraffic: (t) => traffic.push(t) });
    await mcp.call('list_cases', {});
    expect(traffic.map((t) => t.method)).toEqual(expect.arrayContaining(['initialize', 'tools/call']));
    // The optional GET stream answers 405 on a stateless server; every JSON-RPC POST succeeds.
    expect(traffic.filter((t) => t.method !== 'GET').every((t) => t.ms >= 0 && t.status >= 200 && t.status < 300)).toBe(true);
  });
});
