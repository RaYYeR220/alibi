import { OAUTH_MESSAGE, REDIRECT_RESULT_KEY } from './linking/flow.js';

/*
 * Landing page of the hosted sign-in. In a popup it hands the code to the
 * simulator window and closes; after a full-page redirect it parks the result
 * for the simulator to pick up.
 */
const q = new URLSearchParams(location.search);
const message = {
  type: OAUTH_MESSAGE,
  code: q.get('code') ?? undefined,
  state: q.get('state') ?? undefined,
  error: q.get('error_description') ?? q.get('error') ?? undefined,
};

if (window.opener && window.opener !== window) {
  window.opener.postMessage(message, location.origin);
  window.close();
} else {
  sessionStorage.setItem(REDIRECT_RESULT_KEY, q.toString());
  location.replace('/');
}
