import { describe, expect, it } from 'vitest';
import { cognitoVisitors, demoPassword, identityApiKey, serviceTokens, veniceChat } from '../aws.js';

const recorder = (reply: (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => unknown) => {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  return {
    sent,
    client: {
      async send(cmd: unknown) {
        const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
        sent.push({ name: c.constructor.name, input: c.input });
        return reply(c);
      },
    },
  };
};

describe('demo households', () => {
  it('passwords meet the pool policy', () => {
    for (let i = 0; i < 50; i++) {
      const p = demoPassword();
      expect(p.length).toBeGreaterThanOrEqual(10);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
    }
  });

  it('creates a silent user with a permanent password', async () => {
    const r = recorder(() => ({}));
    const creds = await cognitoVisitors({ userPoolId: 'pool', client: r.client })();
    expect(creds.username).toMatch(/^visitor-[0-9a-f]{12}$/);
    expect(r.sent.map((s) => s.name)).toEqual(['AdminCreateUserCommand', 'AdminSetUserPasswordCommand']);
    expect(r.sent[0]!.input).toMatchObject({ UserPoolId: 'pool', Username: creds.username, MessageAction: 'SUPPRESS' });
    expect(r.sent[1]!.input).toMatchObject({ Password: creds.password, Permanent: true });
  });
});

describe('service token', () => {
  it('is cached until shortly before it expires', async () => {
    let now = 0;
    let calls = 0;
    const tokens = serviceTokens({
      cognitoDomain: 'https://auth.test',
      clientId: 'svc',
      secret: async () => 's3cret',
      clock: () => now,
      fetch: async (url, init) => {
        calls++;
        expect(url).toBe('https://auth.test/oauth2/token');
        expect(String(init.body)).toContain('grant_type=client_credentials');
        expect(new Headers(init.headers).get('authorization')).toBe(`Basic ${Buffer.from('svc:s3cret').toString('base64')}`);
        return Response.json({ access_token: `t${calls}`, expires_in: 3600 });
      },
    });
    expect((await tokens()).accessToken).toBe('t1');
    now = 3_400_000;
    expect((await tokens()).accessToken).toBe('t1');
    now = 3_500_000;
    expect((await tokens()).accessToken).toBe('t2');
  });
});

describe('venice key', () => {
  it('comes from the workload identity and the token vault', async () => {
    const r = recorder((c) => (c.constructor.name === 'GetWorkloadAccessTokenCommand' ? { workloadAccessToken: 'wat' } : { apiKey: 'vk' }));
    const key = identityApiKey({ workload: 'alibi-simulator', provider: 'venice', client: r.client });
    expect(await key.get()).toBe('vk');
    expect(await key.get()).toBe('vk');
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]!.input).toEqual({ workloadIdentityToken: 'wat', resourceCredentialProviderName: 'venice' });
  });

  it('re-reads a rejected key once', async () => {
    const keys = ['old', 'new'];
    let i = 0;
    const seen: string[] = [];
    const chat = veniceChat({
      key: { get: async () => keys[i]!, forget: () => i++ },
      fetch: async (_url, init) => {
        const auth = new Headers(init.headers).get('authorization')!;
        seen.push(auth);
        return auth === 'Bearer new' ? Response.json({ choices: [] }) : new Response('no', { status: 401 });
      },
    });
    expect((await chat({ model: 'm' })).status).toBe(200);
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });
});
