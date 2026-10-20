export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
}

export interface LlmRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResponse {
  message: ChatMessage;
  usage: { inTok: number; outTok: number };
}

export interface LlmClient {
  chat(req: LlmRequest): Promise<LlmResponse>;
}

export interface VeniceOptions {
  baseUrl?: string;
  /** Direct calls (Node, eval). */
  apiKey?: string;
  /** Browser calls go through the simulator backend, which holds the key. */
  proxyUrl?: string;
  fetch?: typeof fetch;
  /** Base delay for retries on 429 and 5xx; doubles each attempt. */
  retryDelayMs?: number;
  maxRetries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** OpenAI-compatible chat completions with tool calling, against Venice. */
export function createVeniceClient(opts: VeniceOptions): LlmClient {
  const doFetch = opts.fetch ?? fetch;
  const url = opts.proxyUrl ?? `${opts.baseUrl ?? 'https://api.venice.ai/api/v1'}/chat/completions`;
  return {
    async chat(req) {
      const body = {
        model: req.model,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 600,
        // Venice otherwise prepends its own system prompt.
        venice_parameters: { include_venice_system_prompt: false },
      };
      const maxRetries = opts.maxRetries ?? 4;
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
          body: JSON.stringify(body),
        });
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= maxRetries) break;
        await sleep((opts.retryDelayMs ?? 800) * 2 ** attempt * (1 + Math.random() * 0.25));
      }
      if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as {
        choices: { message: ChatMessage }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const message = json.choices[0]?.message ?? { role: 'assistant', content: '' };
      return { message: { ...message, role: 'assistant' }, usage: { inTok: json.usage?.prompt_tokens ?? 0, outTok: json.usage?.completion_tokens ?? 0 } };
    },
  };
}
