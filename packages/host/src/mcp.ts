import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export interface Traffic {
  method: string;
  ms: number;
  status: number;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  _meta?: { ui?: { resourceUri?: string } };
}

export interface CallOutcome {
  status: 'ok' | 'needs_linking' | 'error';
  result?: { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  error?: string;
}

export interface McpConn {
  tools(): Promise<McpTool[]>;
  call(name: string, args: Record<string, unknown>): Promise<CallOutcome>;
  readResource(uri: string): Promise<string>;
  era(): string | undefined;
  close(): Promise<void>;
}

export interface ConnectOptions {
  url: string;
  /** Called for every request, so a host can switch tokens after account linking without reconnecting. */
  getToken: () => Promise<string | undefined>;
  protocolVersion?: '2025-11-25' | '2026-07-28';
  onTraffic?: (t: Traffic) => void;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

function methodsOf(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') return 'GET';
  try {
    const parsed = JSON.parse(body) as { method?: string } | { method?: string }[];
    return (Array.isArray(parsed) ? parsed : [parsed]).map((m) => m.method ?? 'response').join(',');
  } catch {
    return 'unknown';
  }
}

export async function connectMcp(opts: ConnectOptions): Promise<McpConn> {
  const base = opts.fetch ?? fetch;
  let lastStatus = 0;

  const timedFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const token = await opts.getToken();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (token) headers.set('authorization', `Bearer ${token}`);
    const t0 = performance.now();
    const res = await base(input, { ...init, headers });
    lastStatus = res.status;
    opts.onTraffic?.({ method: methodsOf(init?.body), ms: Math.round(performance.now() - t0), status: res.status });
    return res;
  };

  const client = new Client(
    { name: 'alibi-host', version: '0.1.0' },
    opts.protocolVersion === '2026-07-28' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(opts.url), { fetch: timedFetch }));

  let toolCache: McpTool[] | null = null;
  const html = new Map<string, string>();

  return {
    async tools() {
      toolCache ??= (await client.listTools()).tools as McpTool[];
      return toolCache;
    },
    async call(name, args) {
      try {
        const result = (await client.callTool({ name, arguments: args })) as CallOutcome['result'];
        return { status: result?.isError ? 'error' : 'ok', result };
      } catch (err) {
        if (lastStatus === 401 || lastStatus === 403) return { status: 'needs_linking' };
        return { status: 'error', error: (err as Error).message };
      }
    },
    async readResource(uri) {
      const cached = html.get(uri);
      if (cached !== undefined) return cached;
      const res = await client.readResource({ uri });
      const text = (res.contents[0] as { text?: string } | undefined)?.text ?? '';
      html.set(uri, text);
      return text;
    },
    era: () => client.getProtocolEra(),
    close: () => client.close(),
  };
}
