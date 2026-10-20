import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client';

type Msg = Record<string, unknown> & { id?: string | number; method?: string; params?: Record<string, unknown> };

/**
 * An in-memory MCP Apps host: answers ui/initialize with the given host
 * context, records every request the view makes, and lets a test push
 * notifications such as tool results.
 */
export class FakeHost implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  readonly requests: Msg[] = [];
  readonly notifications: Msg[] = [];
  private initialized!: () => void;
  readonly ready = new Promise<void>((resolve) => (this.initialized = resolve));

  constructor(
    private hostContext: Record<string, unknown> = {},
    private hostCapabilities: Record<string, unknown> = {},
  ) {}

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const m = message as Msg;
    if (m.method && m.id !== undefined) {
      this.requests.push(m);
      const result =
        m.method === 'ui/initialize'
          ? {
              protocolVersion: '2026-01-26',
              hostInfo: { name: 'fake-host', version: '1.0.0' },
              hostCapabilities: this.hostCapabilities,
              hostContext: this.hostContext,
            }
          : m.method === 'ui/request-display-mode'
            ? { mode: (m.params?.mode as string) ?? 'inline' }
            : {};
      queueMicrotask(() => this.onmessage?.({ jsonrpc: '2.0', id: m.id!, result } as JSONRPCMessage));
      return;
    }
    if (m.method) {
      this.notifications.push(m);
      if (m.method === 'ui/notifications/initialized') this.initialized();
    }
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.onmessage?.({ jsonrpc: '2.0', method, params } as JSONRPCMessage);
  }

  toolResult(result: Record<string, unknown>): void {
    this.notify('ui/notifications/tool-result', result);
  }
}
