import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { OAuthError } from '@modelcontextprotocol/server';
import { createCognitoVerifier } from '../src/auth/verifier.js';

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST';
const SERVICE_CLIENT = 'service-client';
const HOUSEHOLD_CLIENT = 'household-client';

let privateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
});

function verifier() {
  return createCognitoVerifier({
    issuer: ISSUER,
    clientIds: [SERVICE_CLIENT, HOUSEHOLD_CLIENT],
    jwks: createLocalJWKSet({ keys: [jwk] }),
  });
}

async function token(claims: Record<string, unknown>, expiresIn = '1h') {
  return new SignJWT({ token_use: 'access', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

describe('cognito verifier', () => {
  it('service token maps to tier service', async () => {
    const info = await verifier()(await token({ client_id: SERVICE_CLIENT, scope: 'alibi/mcp:service' }));
    expect(info.clientId).toBe(SERVICE_CLIENT);
    expect(info.scopes).toEqual(['mcp:service']);
    expect(info.extra).toMatchObject({ tier: 'service' });
    expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('user token maps to tier user', async () => {
    const info = await verifier()(
      await token({ client_id: HOUSEHOLD_CLIENT, sub: 'user-123', scope: 'alibi/mcp:tools alibi/mcp:resources' }),
    );
    expect(info.scopes).toEqual(['mcp:tools', 'mcp:resources']);
    expect(info.extra).toMatchObject({ tier: 'user', sub: 'user-123' });
  });

  it('expired token throws InvalidToken', async () => {
    const expired = await token({ client_id: SERVICE_CLIENT, scope: 'alibi/mcp:service' }, '-1m');
    await expect(verifier()(expired)).rejects.toBeInstanceOf(OAuthError);
  });

  it('unknown client id throws InvalidToken', async () => {
    const foreign = await token({ client_id: 'someone-else', scope: 'alibi/mcp:service' });
    await expect(verifier()(foreign)).rejects.toBeInstanceOf(OAuthError);
  });
});
