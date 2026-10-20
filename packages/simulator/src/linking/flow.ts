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
 * browser treats it as user-initiated. Falls back to a full-page redirect
 * when popups are blocked.
 */
export function linkInPopup(cfg: LinkConfig, loginHint?: string): Promise<Tokens> {
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
      const closed = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error('closed'));
        }
      }, 500);
      const onMessage = (e: MessageEvent) => {
        const m = e.data as CallbackMessage | null;
        if (e.origin !== location.origin || m?.type !== OAUTH_MESSAGE || m.state !== state) return;
        cleanup();
        popup.close();
        if (!m.code) return reject(new Error(m.error ?? 'sign-in was canceled'));
        exchangeCode({ ...cfg, code: m.code, verifier, redirectUri: redirectUri() }).then(resolve, reject);
      };
      const cleanup = () => {
        clearInterval(closed);
        window.removeEventListener('message', onMessage);
      };
      window.addEventListener('message', onMessage);
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
