/** Authorization code + PKCE (S256) against the hosted sign-in, as a public client. */

export const HOUSEHOLD_SCOPES = 'alibi/mcp:tools alibi/mcp:resources';

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomString(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function authorizeUrl(p: {
  cognitoDomain: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  loginHint?: string;
  scope?: string;
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scope ?? HOUSEHOLD_SCOPES,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
  });
  if (p.loginHint) q.set('login_hint', p.loginHint);
  return `${p.cognitoDomain}/oauth2/authorize?${q}`;
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

async function tokenRequest(cognitoDomain: string, body: Record<string, string>, doFetch: typeof fetch): Promise<Tokens> {
  const res = await doFetch(`${cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`sign-in failed: ${json.error ?? res.status}`);
  return {
    accessToken: json.access_token,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

export function exchangeCode(p: { cognitoDomain: string; clientId: string; code: string; verifier: string; redirectUri: string; fetch?: typeof fetch }) {
  return tokenRequest(
    p.cognitoDomain,
    { grant_type: 'authorization_code', client_id: p.clientId, code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri },
    p.fetch ?? fetch,
  );
}

export async function refreshTokens(p: { cognitoDomain: string; clientId: string; refreshToken: string; fetch?: typeof fetch }): Promise<Tokens> {
  const t = await tokenRequest(p.cognitoDomain, { grant_type: 'refresh_token', client_id: p.clientId, refresh_token: p.refreshToken }, p.fetch ?? fetch);
  return { ...t, refreshToken: t.refreshToken ?? p.refreshToken };
}
