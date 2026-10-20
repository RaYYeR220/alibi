import { refreshTokens, type Tokens } from '../linking/pkce.js';

/**
 * Which token the host presents: the shared guest token until the household
 * links its account, then the household's own (refreshed before it expires).
 * The household and its sign-in survive a reload; nothing here is a secret
 * beyond this visitor's own throwaway demo account.
 */

export interface Visitor {
  username: string;
  password: string;
}

interface Saved {
  visitor?: Visitor;
  tokens?: Tokens;
}

const KEY = 'alibi.sim.household';

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private windows may refuse storage; the session still works in memory.
  }
}

export class TokenStore {
  private saved: Saved = load();
  private service: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string | undefined> | null = null;

  constructor(
    private cfg: { cognitoDomain: string; clientId: string },
    private onChange: (linked: boolean) => void,
  ) {}

  get linked(): boolean {
    return !!this.saved.tokens;
  }

  get visitor(): Visitor | undefined {
    return this.saved.visitor;
  }

  setVisitor(v: Visitor): void {
    this.saved = { ...this.saved, visitor: v };
    save(this.saved);
  }

  setTokens(t: Tokens): void {
    this.saved = { ...this.saved, tokens: t };
    save(this.saved);
    this.onChange(true);
  }

  /** Forgets the household and its sign-in: the next link creates a new one. */
  reset(): void {
    this.saved = {};
    save(this.saved);
    this.onChange(false);
  }

  unlink(): void {
    const { tokens: _drop, ...rest } = this.saved;
    this.saved = rest;
    save(this.saved);
    this.onChange(false);
  }

  get(): Promise<string | undefined> {
    this.pending ??= this.resolve().finally(() => (this.pending = null));
    return this.pending;
  }

  private async resolve(): Promise<string | undefined> {
    const t = this.saved.tokens;
    if (t) {
      if (t.expiresAt - 60_000 > Date.now()) return t.accessToken;
      if (t.refreshToken) {
        try {
          const next = await refreshTokens({ ...this.cfg, refreshToken: t.refreshToken });
          this.setTokens(next);
          return next.accessToken;
        } catch {
          // fall through to unlinked
        }
      }
      this.unlink();
    }
    if (this.service && this.service.expiresAt - 60_000 > Date.now()) return this.service.token;
    const res = await fetch('/api/service-token');
    if (!res.ok) throw new Error(`guest token unavailable (${res.status})`);
    const json = (await res.json()) as { access_token: string; expires_at: number };
    this.service = { token: json.access_token, expiresAt: json.expires_at };
    return this.service.token;
  }
}
