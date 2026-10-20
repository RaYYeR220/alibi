import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';

type HandlerOptions = NonNullable<Parameters<typeof createMcpHandler>[1]>;
type FactoryContext = Parameters<Parameters<typeof createMcpHandler>[0]>[0];

export type AlibiFactory = (ctx: FactoryContext) => McpServer;

/**
 * One MCP endpoint for both protocol eras: 2025-era clients (Alexa+ still
 * opens with an initialize handshake) are served statelessly from the same
 * per-request factory as 2026-07-28 clients.
 */
export function createAlibiMcpHandler(factory: AlibiFactory, options?: HandlerOptions) {
  return createMcpHandler(factory, { legacy: 'stateless', ...options });
}
