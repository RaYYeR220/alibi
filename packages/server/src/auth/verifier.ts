import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server';

export type Tier = 'service' | 'user';

export interface VerifierConfig {
  issuer: string;
  clientIds: string[];
  /** Injected in tests; defaults to the issuer's published JWKS. */
  jwks?: JWTVerifyGetKey;
}

export type TokenVerifier = (token: string) => Promise<AuthInfo>;

/** Cognito prefixes resource-server scopes ("alibi/mcp:tools"); tools reason about bare names. */
function bareScopes(scope: unknown): string[] {
  if (typeof scope !== 'string') return [];
  return scope
    .split(' ')
    .filter(Boolean)
    .map((s) => s.slice(s.lastIndexOf('/') + 1));
}

export function createCognitoVerifier(cfg: VerifierConfig): TokenVerifier {
  const jwks = cfg.jwks ?? createRemoteJWKSet(new URL(`${cfg.issuer}/.well-known/jwks.json`));
  const allowed = new Set(cfg.clientIds);

  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer: cfg.issuer }));
    } catch (err) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, `token rejected: ${(err as Error).message}`);
    }
    const clientId = payload.client_id;
    if (payload.token_use !== 'access' || typeof clientId !== 'string' || !allowed.has(clientId)) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'token was not issued to an Alibi client');
    }
    if (typeof payload.exp !== 'number') {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'token has no expiry');
    }
    const sub = typeof payload.sub === 'string' && payload.sub !== clientId ? payload.sub : undefined;
    const tier: Tier = sub ? 'user' : 'service';
    return {
      token,
      clientId,
      scopes: bareScopes(payload.scope),
      expiresAt: payload.exp,
      extra: { tier, sub },
    };
  };
}
