import { authorizeUrl, challengeFor, exchangeCode, randomString, type Tokens } from './pkce.js';

/**
 * Account linking the way an assistant does it: the hosted sign-in opens in a
 * window of its own, returns an authorization code to /callback, and the code
 * is exchanged with the PKCE verifier only this page holds.
 */

export interface LinkConfig {
  cognitoDomain: string;
  clientId: string;
}

export const OAUTH_MESSAGE = 'alibi-oauth';
const REDIRECT_KEY = 'alibi.sim.oauth';

export const redirectUri = () => `${location.origin}/callback`;

interface CallbackMessage {
  type: typeof OAUTH_MESSAGE;
  code?: string;
  state?: string;
  error?: string;
}

/**
 * Must be called from a click: the window opens before any await so the
 * browser treats it as user-initiated. The hosted sign-in sends
 * Cross-Origin-Opener-Policy: same-origin, which cuts the popup off from this
 * window, so the code comes back over a same-origin BroadcastChannel rather
 * than window.opener. Falls back to a full-page redirect when popups are blocked.
 */
export function linkInPopup(cfg: LinkConfig, loginHint?: string, signal?: AbortSignal): Promise<Tokens> {
  const popup = window.open('about:blank', 'alibi-link', 'popup=yes,width=480,height=720');
  const verifier = randomString(48);
  const state = randomString(16);

  return challengeFor(verifier).then((challenge) => {
    const url = authorizeUrl({ ...cfg, redirectUri: redirectUri(), challenge, state, ...(loginHint ? { loginHint } : {}) });
    if (!popup) {
      sessionStorage.setItem(REDIRECT_KEY, JSON.stringify({ verifier, state }));
      location.assign(url);
      return new Promise<Tokens>(() => {});
    }
    popup.location.href = url;

    return new Promise<Tokens>((resolve, reject) => {
      const channel = new BroadcastChannel(OAUTH_MESSAGE);
      const timeout = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), 10 * 60_000);
      const onAbort = () => finish(new Error('canceled'));
      const finish = (err: Error | null, m?: CallbackMessage) => {
        clearTimeout(timeout);
        channel.close();
        window.removeEventListener('message', onWindowMessage);
        signal?.removeEventListener('abort', onAbort);
        try {
          popup.close();
        } catch {
          // already gone
        }
        if (err) return reject(err);
        if (!m?.code) return reject(new Error(m?.error ?? 'Sign-in was canceled.'));
        exchangeCode({ ...cfg, code: m.code, verifier, redirectUri: redirectUri() }).then(resolve, reject);
      };
      const accept = (m: CallbackMessage | null) => {
        if (m?.type === OAUTH_MESSAGE && m.state === state) finish(null, m);
      };
      const onWindowMessage = (e: MessageEvent) => {
        if (e.origin === location.origin) accept(e.data as CallbackMessage);
      };
      channel.onmessage = (e) => accept(e.data as CallbackMessage);
      window.addEventListener('message', onWindowMessage);
      signal?.addEventListener('abort', onAbort);
    });
  });
}

/** After a full-page redirect: finishes the exchange the popup would have done. */
export async function finishRedirect(cfg: LinkConfig): Promise<Tokens | null> {
  const raw = sessionStorage.getItem(REDIRECT_KEY);
  const params = new URLSearchParams(sessionStorage.getItem(`${REDIRECT_KEY}.result`) ?? '');
  sessionStorage.removeItem(REDIRECT_KEY);
  sessionStorage.removeItem(`${REDIRECT_KEY}.result`);
  if (!raw) return null;
  const { verifier, state } = JSON.parse(raw) as { verifier: string; state: string };
  const code = params.get('code');
  if (!code || params.get('state') !== state) return null;
  return exchangeCode({ ...cfg, code, verifier, redirectUri: redirectUri() });
}

export const REDIRECT_RESULT_KEY = `${REDIRECT_KEY}.result`;
