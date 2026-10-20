import { describe, expect, it } from 'vitest';
import { classifyUiMessage } from '../src/bridge/messages.js';
import { createWallet, type Offer, type WalletDeps } from '../src/wallet/wallet.js';

const offer = (priceCents = 499): Offer => ({
  checkoutSessionId: 'cs_abc123',
  sku: 'case:lighthouse',
  title: 'The Lighthouse Keeper',
  priceCents,
  currency: 'USD',
});

function wallet(over: Partial<WalletDeps> = {}) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const spoken: string[] = [];
  const w = createWallet({
    ucpBase: 'https://api.alibi.test/ucp',
    getToken: async () => 'household-token',
    demoPin: '2468',
    speak: (t) => void spoken.push(t),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init, body: JSON.parse(String(init.body)) });
      return Response.json({ id: 'cs_abc123', status: 'completed', order: { id: 'ord_1' } });
    }) as typeof fetch,
    ...over,
  });
  return { w, calls, spoken };
}

describe('wallet phase', () => {
  it('pay message triggers complete with idempotency key and network_token handler', async () => {
    const msg = classifyUiMessage({ role: 'user', content: { type: 'text', text: 'Pay for this order' } });
    expect(msg).toEqual({ kind: 'pay' });

    const { w, calls, spoken } = wallet();
    w.begin(offer());
    expect(w.state().step).toBe('confirm');
    expect(spoken[0]).toBe('Buy The Lighthouse Keeper for $4.99?');
    const done = await w.confirm();

    expect(done.step).toBe('done');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://api.alibi.test/ucp/checkout-sessions/cs_abc123/complete');
    const headers = new Headers(call!.init.headers);
    expect(call!.init.method).toBe('POST');
    expect(headers.get('authorization')).toBe('Bearer household-token');
    expect(headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    const instrument = call!.body.payment.instruments[0];
    expect(call!.body.payment.instruments).toHaveLength(1);
    expect(instrument.handler_id).toBe('amazon_pay_network_token');
    expect(instrument.type).toBe('card');
    expect(instrument.credential.type).toBe('encrypted_network_token');
    expect(instrument.credential.encrypted_token).toMatch(/^tok_alibi_demo_[A-Za-z0-9]+$/);
    expect(instrument.display).toEqual({ brand: 'visa', last_digits: '4242' });
  });

  it('amount over 10000 cents requires pin', async () => {
    const { w, calls, spoken } = wallet();
    w.begin(offer(10_001));
    await w.confirm();
    expect(w.state().step).toBe('pin');
    expect(calls).toHaveLength(0);
    expect(spoken.at(-1)).toMatch(/voice code/i);

    await w.enterPin('1111');
    expect(w.state().step).toBe('pin');
    expect(calls).toHaveLength(0);

    const done = await w.enterPin('2468');
    expect(done.step).toBe('done');
    expect(calls).toHaveLength(1);
  });

  it('amounts at or under the threshold skip the pin unless it is switched on', async () => {
    const plain = wallet();
    plain.w.begin(offer(10_000));
    expect((await plain.w.confirm()).step).toBe('done');

    const strict = wallet({ alwaysPin: true });
    strict.w.begin(offer(499));
    expect((await strict.w.confirm()).step).toBe('pin');
  });

  it('a retried complete reuses the same idempotency key', async () => {
    let n = 0;
    const { w, calls } = wallet({
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init, body: JSON.parse(String(init.body)) });
        if (n++ === 0) return new Response('busy', { status: 503 });
        return Response.json({ id: 'cs_abc123', status: 'completed' });
      }) as typeof fetch,
    });
    w.begin(offer());
    expect((await w.confirm()).step).toBe('done');
    expect(calls).toHaveLength(2);
    const keys = calls.map((c) => new Headers(c.init.headers).get('idempotency-key'));
    expect(keys[0]).toBe(keys[1]);
  });

  it('a decline is spoken and nothing is unlocked', async () => {
    const { w, spoken } = wallet({
      fetch: (async () =>
        Response.json({
          id: 'cs_abc123',
          status: 'incomplete',
          messages: [{ type: 'error', code: 'payment_failed', content: 'Payment was declined. Please try a different payment method.' }],
        })) as typeof fetch,
    });
    w.begin(offer());
    const s = await w.confirm();
    expect(s.step).toBe('failed');
    expect(spoken.at(-1)).toContain('declined');
  });

  it('understands yes, no and spoken digits', async () => {
    const a = wallet();
    a.w.begin(offer());
    expect(await a.w.hear('yes please')).toBe(true);
    expect(a.w.state().step).toBe('done');

    const b = wallet();
    b.w.begin(offer());
    await b.w.hear('no, cancel that');
    expect(b.w.state().step).toBe('canceled');
    expect(b.calls).toHaveLength(0);

    const c = wallet();
    c.w.begin(offer(20_000));
    await c.w.hear('yes');
    await c.w.hear('two four six eight');
    expect(c.w.state().step).toBe('done');
  });
});

describe('ui/message from views', () => {
  it('accepts the spec array form as a user utterance', () => {
    expect(classifyUiMessage({ role: 'user', content: [{ type: 'text', text: 'Send the desk key to the lab' }] })).toEqual({
      kind: 'utterance',
      text: 'Send the desk key to the lab',
    });
  });

  it('treats the purchase phrase as payment in either form', () => {
    expect(classifyUiMessage({ role: 'user', content: [{ type: 'text', text: 'Pay for this order' }] })).toEqual({ kind: 'pay' });
  });

  it('ignores messages without text', () => {
    expect(classifyUiMessage({ role: 'user', content: [] })).toEqual({ kind: 'empty' });
    expect(classifyUiMessage(null)).toEqual({ kind: 'empty' });
  });
});
