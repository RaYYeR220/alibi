import { parseDigits, yesOrNo } from '../core/intent.js';

/**
 * The assistant's payment phase. The add-on only shows a checkout card; the
 * assistant reads the order back, takes the confirmation (and a voice code
 * for large amounts), then completes the merchant's UCP checkout session with
 * a wallet network token. Payment data never passes through the view.
 */

export interface Offer {
  checkoutSessionId: string;
  sku: string;
  title: string;
  priceCents: number;
  currency: 'USD';
  cover?: string;
}

export type WalletState =
  | { step: 'idle' }
  | { step: 'confirm'; offer: Offer }
  | { step: 'pin'; offer: Offer; tries: number }
  | { step: 'paying'; offer: Offer }
  | { step: 'done'; offer: Offer; orderId?: string }
  | { step: 'failed'; offer: Offer; message: string }
  | { step: 'canceled'; offer: Offer };

export interface DemoCard {
  brand: 'visa' | 'mastercard';
  lastDigits: string;
  expiryMonth: string;
  expiryYear: string;
}

export const DEMO_CARD: DemoCard = { brand: 'visa', lastDigits: '4242', expiryMonth: '09', expiryYear: '2029' };

/** Amounts above $100 need the household's voice code before a purchase goes through. */
export const PIN_THRESHOLD_CENTS = 10_000;

export interface UcpCall {
  method: string;
  url: string;
  status: number;
  ms: number;
  request: unknown;
  response: unknown;
}

export interface WalletDeps {
  ucpBase: string;
  getToken: () => Promise<string | undefined>;
  speak: (text: string) => void | Promise<void>;
  demoPin: string;
  fetch?: typeof fetch;
  alwaysPin?: boolean;
  card?: DemoCard;
  onChange?: (s: WalletState) => void;
  onCall?: (c: UcpCall) => void;
  uuid?: () => string;
}

export interface Wallet {
  state(): WalletState;
  begin(offer: Offer): WalletState;
  confirm(): Promise<WalletState>;
  enterPin(pin: string): Promise<WalletState>;
  cancel(): WalletState;
  /** Feeds a spoken reply into the phase; false when the phase is not waiting for one. */
  hear(text: string): Promise<boolean>;
  reset(): void;
}

export const price = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const token = (n = 24) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join('');
};

/** The completion body Alexa+ documents for the network-token handler, with simulator demo credentials. */
export function networkTokenPayment(card: DemoCard = DEMO_CARD) {
  return {
    payment: {
      instruments: [
        {
          id: `instr_${token(12)}`,
          handler_id: 'amazon_pay_network_token',
          type: 'card',
          billing_address: {
            street_address: '221 Baker Avenue',
            address_locality: 'Springfield',
            address_region: 'IL',
            address_country: 'US',
            postal_code: '62701',
          },
          credential: {
            type: 'encrypted_network_token',
            encrypted_token: `tok_alibi_demo_${token()}`,
            encrypted_cryptogram: `cryptogram_alibi_demo_${token(16)}`,
            eci: '05',
            expiry_month: card.expiryMonth,
            expiry_year: card.expiryYear,
          },
          display: { brand: card.brand, last_digits: card.lastDigits },
        },
      ],
    },
  };
}

export function createWallet(deps: WalletDeps): Wallet {
  const doFetch = deps.fetch ?? fetch.bind(globalThis);
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  let s: WalletState = { step: 'idle' };

  const set = (next: WalletState) => {
    s = next;
    deps.onChange?.(s);
    return s;
  };
  const say = (text: string) => void deps.speak(text);
  const needsPin = (o: Offer) => deps.alwaysPin === true || o.priceCents > PIN_THRESHOLD_CENTS;

  async function complete(offer: Offer): Promise<WalletState> {
    set({ step: 'paying', offer });
    const url = `${deps.ucpBase}/checkout-sessions/${encodeURIComponent(offer.checkoutSessionId)}/complete`;
    const body = networkTokenPayment(deps.card);
    // One key per purchase attempt: a retry after a lost reply must not charge twice.
    const key = uuid();
    const attempt = async () => {
      const t0 = performance.now();
      const bearer = await deps.getToken();
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          'request-id': `req_${token(12)}`,
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      deps.onCall?.({ method: 'POST /checkout-sessions/{id}/complete', url, status: res.status, ms: Math.round(performance.now() - t0), request: body, response: json });
      return { res, json: json as { status?: string; order?: { id?: string }; messages?: { type?: string; content?: string }[] } | null };
    };

    let reply: Awaited<ReturnType<typeof attempt>> | null = null;
    for (let i = 0; i < 2; i++) {
      try {
        reply = await attempt();
        if (reply.res.status < 500) break;
      } catch {
        reply = null;
      }
    }

    if (!reply || reply.res.status >= 400 || !reply.json) {
      const message = reply?.res.status === 401 ? 'Your account needs to be linked before you can buy that.' : "I couldn't reach the store just now. You haven't been charged.";
      say(message);
      return set({ step: 'failed', offer, message });
    }
    if (reply.json.status === 'completed') {
      say(`Done. ${offer.title} is yours.`);
      return set({ step: 'done', offer, ...(reply.json.order?.id ? { orderId: reply.json.order.id } : {}) });
    }
    const message = reply.json.messages?.find((m) => m.type === 'error')?.content ?? "That purchase didn't go through.";
    say(message);
    return set({ step: 'failed', offer, message });
  }

  const wallet: Wallet = {
    state: () => s,
    begin(offer) {
      say(`Buy ${offer.title} for ${price(offer.priceCents)}?`);
      return set({ step: 'confirm', offer });
    },
    async confirm() {
      if (s.step !== 'confirm') return s;
      if (needsPin(s.offer)) {
        say('Say your four-digit voice code.');
        return set({ step: 'pin', offer: s.offer, tries: 0 });
      }
      return complete(s.offer);
    },
    async enterPin(pin) {
      if (s.step !== 'pin') return s;
      if (pin === deps.demoPin) return complete(s.offer);
      const tries = s.tries + 1;
      if (tries >= 3) {
        say("That code didn't match, so I've canceled the purchase.");
        return set({ step: 'canceled', offer: s.offer });
      }
      say("That code didn't match. Try again.");
      return set({ step: 'pin', offer: s.offer, tries });
    },
    cancel() {
      if (s.step === 'idle') return s;
      say('Okay, I canceled that.');
      return set({ step: 'canceled', offer: s.offer });
    },
    async hear(text) {
      if (s.step === 'confirm') {
        const answer = yesOrNo(text);
        if (answer === 'yes') await wallet.confirm();
        else if (answer === 'no') wallet.cancel();
        else say(`Should I buy ${s.offer.title}? Say yes or no.`);
        return true;
      }
      if (s.step === 'pin') {
        if (yesOrNo(text) === 'no') {
          wallet.cancel();
          return true;
        }
        await wallet.enterPin(parseDigits(text));
        return true;
      }
      return false;
    },
    reset() {
      set({ step: 'idle' });
    },
  };
  return wallet;
}
