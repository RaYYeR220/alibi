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

export interface ResourceMeta {
  ui?: {
    csp?: { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] };
    permissions?: Record<string, object>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ResourceContent {
  text: string;
  mimeType?: string;
  meta?: ResourceMeta;
}

export interface McpConn {
  tools(): Promise<McpTool[]>;
  call(name: string, args: Record<string, unknown>): Promise<CallOutcome>;
  /** Text of a resource. View html (ui://) is cached; everything else is read fresh. */
  readResource(uri: string): Promise<string>;
  /** A resource with its mime type and _meta (for views: the declared csp and permissions). */
  resource(uri: string): Promise<ResourceContent>;
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
  const views = new Map<string, ResourceContent>();

  const resource = async (uri: string): Promise<ResourceContent> => {
    const cached = views.get(uri);
    if (cached) return cached;
    const res = await client.readResource({ uri });
    const first = res.contents[0] as { text?: string; mimeType?: string; _meta?: ResourceMeta } | undefined;
    const content: ResourceContent = {
      text: first?.text ?? '',
      ...(first?.mimeType ? { mimeType: first.mimeType } : {}),
      ...(first?._meta ? { meta: first._meta } : {}),
    };
    // Views are static per deployment; household resources (inbox) change and must stay fresh.
    if (uri.startsWith('ui://')) views.set(uri, content);
    return content;
  };

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
      return (await resource(uri)).text;
    },
    resource,
    era: () => client.getProtocolEra(),
    close: () => client.close(),
  };
}
