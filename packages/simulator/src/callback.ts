import { OAUTH_MESSAGE, REDIRECT_RESULT_KEY } from './linking/flow.js';

/*
 * Landing page of the hosted sign-in. After a full-page redirect it parks the
 * result for the simulator and goes back; in the sign-in window it hands the
 * code to the simulator over a BroadcastChannel (the sign-in page's opener
 * policy leaves this window without an opener) and closes.
 */
const q = new URLSearchParams(location.search);
const message = {
  type: OAUTH_MESSAGE,
  code: q.get('code') ?? undefined,
  state: q.get('state') ?? undefined,
  error: q.get('error_description') ?? q.get('error') ?? undefined,
};

if (sessionStorage.getItem('alibi.sim.oauth')) {
  sessionStorage.setItem(REDIRECT_RESULT_KEY, q.toString());
  location.replace('/');
} else {
  const channel = new BroadcastChannel(OAUTH_MESSAGE);
  channel.postMessage(message);
  window.opener?.postMessage(message, location.origin);
  setTimeout(() => {
    window.close();
    const p = document.querySelector('p');
    if (p) p.textContent = message.code ? 'Your account is linked. You can close this window.' : 'Sign-in did not finish. Close this window and try again.';
  }, 300);
}
