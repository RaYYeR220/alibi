import type { ChatMessage, LlmClient, ToolSpec } from './llm.js';
import type { CallOutcome, McpConn, McpTool } from './mcp.js';
import { HOST_PROMPT } from './prompt.js';

export interface UiFrame {
  resourceUri: string;
  html: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: CallOutcome['result'];
}

export interface TurnResult {
  speech: string;
  ui: UiFrame[];
  toolCalls: { name: string; args: Record<string, unknown>; ms: number; status: CallOutcome['status'] }[];
  needsLinking: boolean;
  usage: { inTok: number; outTok: number };
}

export interface Host {
  turn(utterance: string): Promise<TurnResult>;
  history(): ChatMessage[];
  reset(): void;
}

export interface HostOptions {
  llm: LlmClient;
  mcp: McpConn;
  model: string;
  systemPrompt?: string;
  maxSteps?: number;
}

export const LINK_SPEECH = 'To do that, link your Alibi account. I can show you how.';

const textOf = (r: CallOutcome['result']) =>
  (r?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');

const toSpec = (t: McpTool): ToolSpec => ({
  type: 'function',
  function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.inputSchema },
});

/**
 * A minimal assistant host: one LLM, the add-on's MCP tools, a tool loop per
 * spoken turn. It remembers the active game_id and fills it in when the model
 * forgets, the way a production host keeps conversation state.
 */
export function createHost(opts: HostOptions): Host {
  const maxSteps = opts.maxSteps ?? 6;
  let messages: ChatMessage[] = [];
  let gameId: string | undefined;

  return {
    history: () => messages.slice(),
    reset: () => {
      messages = [];
      gameId = undefined;
    },
    async turn(utterance) {
      messages.push({ role: 'user', content: utterance });
      const tools = await opts.mcp.tools();
      const specs = tools.map(toSpec);
      const byName = new Map(tools.map((t) => [t.name, t]));
      const out: TurnResult = { speech: '', ui: [], toolCalls: [], needsLinking: false, usage: { inTok: 0, outTok: 0 } };

      for (let step = 0; step < maxSteps; step++) {
        const { message, usage } = await opts.llm.chat({
          model: opts.model,
          messages: [{ role: 'system', content: opts.systemPrompt ?? HOST_PROMPT }, ...messages],
          tools: specs,
        });
        out.usage.inTok += usage.inTok;
        out.usage.outTok += usage.outTok;
        messages.push(message);
        if (!message.tool_calls?.length) {
          out.speech = (message.content ?? '').trim();
          return out;
        }

        for (const tc of message.tool_calls) {
          const tool = byName.get(tc.function.name);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            args = {};
          }
          if (tool?.inputSchema.properties && 'game_id' in tool.inputSchema.properties && !args.game_id && gameId) args.game_id = gameId;

          const t0 = performance.now();
          const outcome = tool ? await opts.mcp.call(tc.function.name, args) : { status: 'error' as const, error: `no tool ${tc.function.name}` };
          out.toolCalls.push({ name: tc.function.name, args, ms: Math.round(performance.now() - t0), status: outcome.status });

          if (outcome.status === 'needs_linking') {
            out.needsLinking = true;
            out.speech = LINK_SPEECH;
            messages.push({ role: 'tool', tool_call_id: tc.id, content: 'The household must link their Alibi account first.' });
            messages.push({ role: 'assistant', content: LINK_SPEECH });
            return out;
          }

          const sc = outcome.result?.structuredContent;
          if (sc && typeof sc.gameId === 'string') gameId = sc.gameId;
          const uri = tool?._meta?.ui?.resourceUri;
          if (uri && outcome.result?.structuredContent) {
            out.ui.push({ resourceUri: uri, html: await opts.mcp.readResource(uri), toolName: tc.function.name, toolInput: args, toolResult: outcome.result });
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: outcome.status === 'ok' ? textOf(outcome.result) : `Error: ${outcome.error ?? textOf(outcome.result)}` });
        }
      }
      out.speech = 'Sorry, I lost my train of thought. Could you say that again?';
      return out;
    },
  };
}
