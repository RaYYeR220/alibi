import type { AuthInfo } from '@modelcontextprotocol/server';
import { TOOL_TIERS } from '../tools/common.js';

export type Verify = (token: string) => Promise<AuthInfo>;

/**
 * Alexa+ starts account linking when a request answers HTTP 401 (or 403)
 * and expects no WWW-Authenticate header on it, so every refusal here is a
 * bare 401.
 */
const unauthorized = () => new Response(null, { status: 401 });

/** Methods a client may call before it holds a token, to discover what the server offers. */
const DISCOVERY = new Set([
  'initialize',
  'ping',
  'server/discover',
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
]);

/** Resources that belong to a household rather than to the add-on. */
const HOUSEHOLD_RESOURCES = /^alibi:\/\/household\//;

type Message = { method?: unknown; params?: { name?: unknown; uri?: unknown } };

type Need = 'none' | 'service' | 'user';

function need(m: Message): Need {
  const method = typeof m.method === 'string' ? m.method : '';
  if (!method || method.startsWith('notifications/') || DISCOVERY.has(method)) return 'none';
  if (method === 'tools/call') return TOOL_TIERS[String(m.params?.name ?? '')] === 'user' ? 'user' : 'service';
  if (method === 'resources/read' && HOUSEHOLD_RESOURCES.test(String(m.params?.uri ?? ''))) return 'user';
  return 'service';
}

/** A service token carries mcp:service; a household token carries mcp:tools (and mcp:resources). */
function satisfies(authInfo: AuthInfo | undefined, required: Need): boolean {
  if (required === 'none') return true;
  if (!authInfo) return false;
  const tier = (authInfo.extra as { tier?: string } | undefined)?.tier;
  const scopes = new Set(authInfo.scopes);
  if (required === 'user') return tier === 'user' && scopes.has('mcp:tools');
  return scopes.has('mcp:service') || (tier === 'user' && scopes.has('mcp:tools'));
}

/** Fail-closed: everything except discovery needs a verified token with the right scope. */
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
  } else if (header) {
    return unauthorized();
  }
  if (req.method !== 'POST') return authInfo || req.method === 'DELETE' ? { authInfo } : unauthorized();
  const messages: Message[] = (Array.isArray(body) ? body : [body]).filter((m): m is Message => typeof m === 'object' && m !== null);
  if (messages.length === 0) return unauthorized();
  for (const m of messages) {
    if (!satisfies(authInfo, need(m))) return unauthorized();
  }
  return { authInfo };
}
