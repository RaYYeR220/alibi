import type { AuthInfo } from '@modelcontextprotocol/server';
import { TOOL_TIERS } from '../tools/common.js';

export type Verify = (token: string) => Promise<AuthInfo>;

/**
 * Alexa+ starts account linking when a tool call answers HTTP 401 (or 403)
 * and expects no WWW-Authenticate header on it, so every refusal here is a
 * bare 401.
 */
const unauthorized = () => new Response(null, { status: 401 });

function toolCalls(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages
    .filter((m): m is { method: string; params?: { name?: unknown } } => typeof m === 'object' && m !== null && (m as { method?: unknown }).method === 'tools/call')
    .map((m) => String(m.params?.name ?? ''));
}

export async function gate(req: Request, body: unknown, verify: Verify): Promise<{ authInfo?: AuthInfo } | Response> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  let authInfo: AuthInfo | undefined;
  if (match) {
    try {
      authInfo = await verify(match[1]!.trim());
    } catch {
      return unauthorized();
    }
  }
  const tier = (authInfo?.extra as { tier?: string } | undefined)?.tier;
  for (const name of toolCalls(body)) {
    if (TOOL_TIERS[name] === 'user' && tier !== 'user') return unauthorized();
  }
  return { authInfo };
}
