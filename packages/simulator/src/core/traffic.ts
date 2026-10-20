/**
 * Protocol log for the inspector: every MCP request the host sends, with its
 * JSON-RPC method, HTTP status and full round-trip time (until the response
 * body has arrived), plus the checkout calls of the payment phase.
 */

export interface TrafficEntry {
  seq: number;
  at: number;
  kind: 'mcp' | 'ucp';
  method: string;
  /** For tools/call, the tool name. */
  detail?: string;
  status: number;
  ms: number;
  request?: unknown;
  response?: unknown;
}

export interface LlmEntry {
  seq: number;
  at: number;
  model: string;
  ms: number;
  inTok: number;
  outTok: number;
  status: 'ok' | 'error';
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let seq = 0;
export const nextSeq = () => ++seq;

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Streamable HTTP answers either JSON or an SSE stream of JSON-RPC messages. */
export function parseResponse(text: string, contentType: string | null): unknown {
  if (!text) return undefined;
  if (contentType?.includes('text/event-stream')) {
    const messages = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => {
        try {
          return JSON.parse(l.slice(5).trim());
        } catch {
          return l.slice(5).trim();
        }
      });
    return messages.length === 1 ? messages[0] : messages;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describe(request: unknown): { method: string; detail?: string } {
  const msgs = (Array.isArray(request) ? request : [request]) as { method?: string; params?: { name?: string; uri?: string } }[];
  const first = msgs[0];
  if (!first || typeof first !== 'object') return { method: 'GET stream' };
  const method = msgs.map((m) => m.method ?? 'response').join(', ');
  const detail = first.params?.name ?? first.params?.uri;
  return detail ? { method, detail } : { method };
}

export function tracedFetch(base: Fetch, onEntry: (e: TrafficEntry) => void): Fetch {
  return async (input, init) => {
    const request = parseBody(init?.body);
    const { method, detail } = init?.method === 'GET' || init?.method === 'DELETE' ? { method: `${init.method} stream` } : describe(request);
    const t0 = performance.now();
    const res = await base(input, init);
    const entry: TrafficEntry = { seq: nextSeq(), at: Date.now(), kind: 'mcp', method, ...(detail ? { detail } : {}), status: res.status, ms: 0, request };
    const streaming = res.headers.get('content-type')?.includes('text/event-stream') && init?.method === 'GET';
    if (streaming || res.status === 202 || res.status === 204) {
      entry.ms = Math.round(performance.now() - t0);
      onEntry(entry);
      return res;
    }
    // Time the whole exchange, not just the headers: the result arrives in the body.
    res
      .clone()
      .text()
      .then(
        (text) => {
          entry.ms = Math.round(performance.now() - t0);
          entry.response = parseResponse(text, res.headers.get('content-type'));
          onEntry(entry);
        },
        () => {
          entry.ms = Math.round(performance.now() - t0);
          onEntry(entry);
        },
      );
    return res;
  };
}
