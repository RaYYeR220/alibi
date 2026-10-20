import { randomBytes, randomInt } from 'node:crypto';
import { BedrockAgentCoreClient, GetResourceApiKeyCommand, GetWorkloadAccessTokenCommand } from '@aws-sdk/client-bedrock-agentcore';
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

type Send = { send(cmd: unknown): Promise<unknown> };

/** Generative Polly speech as MP3. */
export function pollySpeech(client: Send = new PollyClient({}) as unknown as Send) {
  return async (text: string, voice: string): Promise<Uint8Array> => {
    const res = (await client.send(
      new SynthesizeSpeechCommand({ Engine: 'generative', OutputFormat: 'mp3', SampleRate: '24000', Text: text, VoiceId: voice as never }),
    )) as { AudioStream?: { transformToByteArray(): Promise<Uint8Array> } };
    if (!res.AudioStream) throw new Error('polly returned no audio');
    return res.AudioStream.transformToByteArray();
  };
}

const WORDS = [
  'Amber', 'Ashby', 'Attic', 'Badge', 'Brass', 'Candle', 'Cellar', 'Cipher', 'Clock', 'Clue', 'Cobalt', 'Copper',
  'Dagger', 'Ember', 'Fable', 'Fog', 'Garnet', 'Gravel', 'Harbor', 'Hatch', 'Inkwell', 'Ivory', 'Jasper', 'Key',
  'Lantern', 'Ledger', 'Locket', 'Marble', 'Mirror', 'Monocle', 'Night', 'Oak', 'Opal', 'Owl', 'Parlor', 'Pearl',
  'Quill', 'Raven', 'Ribbon', 'Ruby', 'Satchel', 'Scarlet', 'Shadow', 'Signet', 'Silver', 'Slate', 'Sparrow', 'Study',
  'Thimble', 'Thistle', 'Tower', 'Trunk', 'Velvet', 'Violet', 'Walnut', 'Whisper', 'Willow', 'Window', 'Wren', 'Yew',
];

/** Easy to read aloud and type, and still meets the pool's policy (upper, lower, digits, 10+). */
export function demoPassword(): string {
  const word = () => WORDS[randomInt(WORDS.length)]!;
  return `${word()}-${word()}-${word()}-${String(randomInt(10_000)).padStart(4, '0')}`;
}

export const visitorName = () => `visitor-${randomBytes(6).toString('hex')}`;

/** A fresh household per visitor: an Alibi user with a permanent password and no welcome mail. */
export function cognitoVisitors(cfg: { userPoolId: string; client?: Send }) {
  const client = cfg.client ?? (new CognitoIdentityProviderClient({}) as unknown as Send);
  return async () => {
    const username = visitorName();
    const password = demoPassword();
    await client.send(new AdminCreateUserCommand({ UserPoolId: cfg.userPoolId, Username: username, MessageAction: 'SUPPRESS' }));
    await client.send(new AdminSetUserPasswordCommand({ UserPoolId: cfg.userPoolId, Username: username, Password: password, Permanent: true }));
    return { username, password };
  };
}

/** The service client's secret, read once from Cognito so it never sits in configuration. */
export function cognitoClientSecret(cfg: { userPoolId: string; clientId: string; client?: Send }) {
  const client = cfg.client ?? (new CognitoIdentityProviderClient({}) as unknown as Send);
  let secret: Promise<string> | null = null;
  return () => {
    secret ??= (client.send(new DescribeUserPoolClientCommand({ UserPoolId: cfg.userPoolId, ClientId: cfg.clientId })) as Promise<{
      UserPoolClient?: { ClientSecret?: string };
    }>).then((r) => {
      const s = r.UserPoolClient?.ClientSecret;
      if (!s) throw new Error('service client has no secret');
      return s;
    });
    secret.catch(() => (secret = null));
    return secret;
  };
}

type TokenFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Tier-1 client-credentials token, shared by every guest the way an
 * assistant's agent token is; refreshed two minutes before it expires.
 */
export function serviceTokens(cfg: {
  cognitoDomain: string;
  clientId: string;
  secret: () => Promise<string>;
  scope?: string;
  clock?: () => number;
  fetch?: TokenFetch;
}) {
  const clock = cfg.clock ?? Date.now;
  const doFetch = cfg.fetch ?? (fetch as TokenFetch);
  let cached: { accessToken: string; expiresAt: number } | null = null;
  let inflight: Promise<{ accessToken: string; expiresAt: number }> | null = null;

  const refresh = async () => {
    const secret = await cfg.secret();
    const res = await doFetch(`${cfg.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${cfg.clientId}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: cfg.scope ?? 'alibi/mcp:service' }).toString(),
    });
    if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cached = { accessToken: json.access_token, expiresAt: clock() + json.expires_in * 1000 };
    return cached;
  };

  return async () => {
    if (cached && cached.expiresAt - 120_000 > clock()) return cached;
    inflight ??= refresh().finally(() => (inflight = null));
    return inflight;
  };
}

/**
 * The Venice key from AgentCore Identity: the function authenticates as its
 * workload identity and reads the API-key credential from the token vault.
 */
export function identityApiKey(cfg: { workload: string; provider: string; client?: Send }) {
  const client = cfg.client ?? (new BedrockAgentCoreClient({}) as unknown as Send);
  let key: Promise<string> | null = null;
  const load = async () => {
    const { workloadAccessToken } = (await client.send(new GetWorkloadAccessTokenCommand({ workloadName: cfg.workload }))) as {
      workloadAccessToken?: string;
    };
    if (!workloadAccessToken) throw new Error('no workload access token');
    const { apiKey } = (await client.send(
      new GetResourceApiKeyCommand({ workloadIdentityToken: workloadAccessToken, resourceCredentialProviderName: cfg.provider }),
    )) as { apiKey?: string };
    if (!apiKey) throw new Error('no api key from the token vault');
    return apiKey;
  };
  return {
    get: () => {
      key ??= load();
      key.catch(() => (key = null));
      return key;
    },
    forget: () => {
      key = null;
    },
  };
}

/** Chat completions against Venice; a rejected key is re-read once (it may have been rotated). */
export function veniceChat(cfg: { key: { get(): Promise<string>; forget(): void }; baseUrl?: string; fetch?: TokenFetch }) {
  const doFetch = cfg.fetch ?? (fetch as TokenFetch);
  const url = `${cfg.baseUrl ?? 'https://api.venice.ai/api/v1'}/chat/completions`;
  const once = async (body: object) =>
    doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await cfg.key.get()}` },
      body: JSON.stringify(body),
    });
  return async (body: object) => {
    let res = await once(body);
    if (res.status === 401) {
      cfg.key.forget();
      res = await once(body);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text.slice(0, 200) };
    }
    if (res.status !== 200) console.error('[sim] venice', res.status, text.slice(0, 300));
    return { status: res.status, json };
  };
}
