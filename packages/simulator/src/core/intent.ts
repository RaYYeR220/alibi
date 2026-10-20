/** Small, deterministic readers for the few things the assistant itself must understand. */

const NO = /\b(no|nope|nah|cancel|stop|don'?t|do not|never ?mind|not now)\b/i;
const YES = /\b(yes|yeah|yep|yup|sure|ok(ay)?|confirm(ed)?|go ahead|do it|please do|buy( it)?|pay|purchase|place (the )?order|absolutely|correct)\b/i;

export function yesOrNo(text: string): 'yes' | 'no' | null {
  if (NO.test(text)) return 'no';
  if (YES.test(text)) return 'yes';
  return null;
}

const PURCHASE = /\b(yes|yeah|yep|sure|ok(ay)?|go ahead|do it|buy|purchase|pay|order|get it|confirm)\b/i;

/** "Yes" or "buy it" right after a checkout card, the way a voice purchase starts. */
export function isPurchaseIntent(text: string): boolean {
  return !NO.test(text) && PURCHASE.test(text);
}

const DIGITS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};
/** Words speech recognition writes for digits, trusted only once a code has started. */
const HOMOPHONES: Record<string, string> = { to: '2', too: '2', for: '4', o: '0' };

/** Digits spoken as words ("two four six eight") or figures ("2 4 6 8"), in order. */
export function parseDigits(text: string): string {
  let out = '';
  for (const token of text.toLowerCase().match(/[a-z]+|\d+/g) ?? []) {
    if (/^\d+$/.test(token)) out += token;
    else if (Object.hasOwn(DIGITS, token)) out += DIGITS[token];
    else if (out && Object.hasOwn(HOMOPHONES, token)) out += HOMOPHONES[token];
  }
  return out;
}
