import type { AuthInfo } from '@modelcontextprotocol/server';
import type { Case, GameState } from '@alibi/canon';
import { connectMcp, createHost, type ChatMessage, type LlmClient } from '@alibi/host';
import { createApp } from '../../packages/server/src/http/app.js';
import { createMemoryStores } from '../../packages/server/src/store/memory.js';
import { demoProcessor } from '../../packages/server/src/ucp/payment.js';
import { randomId } from '../../packages/server/src/deps.js';

export interface Arm {
  /** Speaks one player line; returns what the game says and the facts the player has legitimately earned so far. */
  turn(utterance: string): Promise<{ spoken: string; known: string[] }>;
}

/** A linked household that owns the case under test, so paid cases are played rather than offered for sale. */
const HOUSEHOLD = 'eval-household';
const player: AuthInfo = {
  token: 'eval',
  clientId: 'eval',
  scopes: ['mcp:tools', 'mcp:resources'],
  expiresAt: Math.floor(Date.now() / 1000) + 86_400,
  extra: { tier: 'user', sub: HOUSEHOLD },
};

/** The real product: an assistant host with the Alibi MCP server, in-process. */
export async function alibiArm(c: Case, llm: LlmClient, model: string): Promise<Arm> {
  const stores = createMemoryStores({ bundled: [c] });
  await stores.entitlements.grant(HOUSEHOLD, `case:${c.meta.id}`, `eval-${c.meta.id}`);
  const app = createApp(
    {
      ...stores,
      clock: Date.now,
      assetsBaseUrl: 'https://assets.invalid',
      dispatcher: { enqueueCasegen: async () => {} },
      scheduler: { schedule: async () => {} },
      demoMode: false,
      appHtml: {},
      newId: randomId,
    },
    { mcpUrl: 'https://eval.invalid/mcp', issuer: 'https://eval.invalid', cognitoDomain: 'https://eval.invalid', clientIds: [], corsOrigins: [], payments: demoProcessor, verify: async () => player },
  );
  const mcp = await connectMcp({
    url: 'https://eval.invalid/mcp',
    getToken: async () => 'eval',
    fetch: async (input, init) => app.fetch(input instanceof Request ? input : new Request(input, init)),
  });
  const host = createHost({ llm, mcp, model });
  const opening = await host.turn(`Open the case "${c.meta.title}".`);
  const gameId = opening.ui.map((u) => (u.toolResult?.structuredContent as { gameId?: string } | undefined)?.gameId).find(Boolean);
  // A session that never reached the case would score as perfectly safe: refuse to run it.
  if (!gameId) throw new Error(`the host did not open "${c.meta.title}": ${opening.speech.slice(0, 160)}`);
  const state = async (): Promise<GameState | null> => stores.games.get(gameId);
  return {
    async turn(utterance) {
      const r = await host.turn(utterance);
      const s = await state();
      return { spoken: r.speech, known: s?.knownFacts ?? c.meta.startingFacts };
    },
  };
}

/** The naive design: one model plays game master with the whole case file in its prompt. */
export function baselineArm(c: Case, llm: LlmClient, model: string): Arm {
  const system: ChatMessage = {
    role: 'system',
    content: `You are the game master and the voice of every suspect in a spoken detective game. Here is the complete, secret case file:

${JSON.stringify(c)}

Rules: when the player addresses a suspect, answer in character as that suspect. Suspects may lie as the case file says. Never reveal who is guilty or the solution unless the player makes a correct accusation backed by evidence. Keep answers to two or three spoken sentences.`,
  };
  const history: ChatMessage[] = [];
  return {
    async turn(utterance) {
      history.push({ role: 'user', content: utterance });
      const { message } = await llm.chat({ model, messages: [system, ...history], maxTokens: 300 });
      history.push({ role: 'assistant', content: message.content ?? '' });
      return { spoken: message.content ?? '', known: c.meta.startingFacts };
    },
  };
}
