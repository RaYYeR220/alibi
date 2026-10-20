import { describe, expect, it } from 'vitest';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { parseCase, type CaseIntroView, type PurchaseView } from '@alibi/canon';
import { createApp } from '../src/http/app.js';
import { demoProcessor } from '../src/ucp/payment.js';
import { connect, serviceAuth, testDeps, text, tinyCase, userAuth, view } from './harness.js';

const paid = parseCase({ ...structuredClone(tinyCase), meta: { ...tinyCase.meta, id: 'tiny-paid', title: 'The Paid Brooch', priceCents: 499 } });

const cfg = {
  mcpUrl: 'https://api.alibi.test/mcp',
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST',
  cognitoDomain: 'https://alibi.auth.us-east-1.amazoncognito.com',
  clientIds: ['service-client', 'household-client'],
  corsOrigins: ['https://play.alibi.test'],
  payments: demoProcessor,
  verify: async (token: string) => {
    if (token === 'service') return serviceAuth;
    if (token.startsWith('hh-')) return userAuth(token.slice(3));
    throw new OAuthError(OAuthErrorCode.InvalidToken, 'bad token');
  },
};

function setup() {
  const deps = testDeps({}, [tinyCase, paid]);
  const app = createApp(deps, cfg);
  const ucp = (method: string, path: string, token: string, body?: object, idem?: string) =>
    app.fetch(
      new Request(`https://api.alibi.test/ucp${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'ucp-agent': 'profile="https://alexa.amazon.com/.well-known/ucp"',
          ...(idem ? { 'idempotency-key': idem } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  return { deps, app, ucp };
}

const createBody = { line_items: [{ item: { id: 'case:tiny-paid' }, quantity: 1 }] };
const demoCard = (token = 'tok_alibi_demo_abc') => ({
  payment: {
    instruments: [
      {
        id: 'instr_1',
        handler_id: 'amazon_pay_network_token',
        type: 'card',
        credential: { type: 'encrypted_network_token', encrypted_token: token, encrypted_cryptogram: 'c', eci: '05', expiry_month: '09', expiry_year: '2028' },
        display: { brand: 'visa', last_digits: '4242' },
      },
    ],
  },
});

describe('UCP merchant', () => {
  it('well-known ucp declares version 2026-04-08 and both handlers', async () => {
    const { app } = setup();
    const res = await app.fetch(new Request('https://api.alibi.test/.well-known/ucp'));
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const { ucp } = await res.json();
    expect(ucp.version).toBe('2026-04-08');
    expect(ucp.capabilities['dev.ucp.shopping.checkout'][0]).toMatchObject({ version: '2026-04-08' });
    expect(ucp.services['dev.ucp.shopping'][0]).toMatchObject({ transport: 'rest', endpoint: 'https://api.alibi.test/ucp' });
    expect(Object.keys(ucp.payment_handlers).sort()).toEqual(['com.amazon.payments.network_token', 'com.amazon.payments.stored_payment_method']);
  });

  it('create session totals 499 for a case', async () => {
    const { ucp } = setup();
    const res = await ucp('POST', '/checkout-sessions', 'hh-alice', createBody, 'k1');
    expect(res.status).toBe(201);
    const s = await res.json();
    expect(s).toMatchObject({ status: 'ready_for_complete', currency: 'USD', messages: [] });
    expect(s.totals).toEqual([
      { type: 'subtotal', amount: 499 },
      { type: 'tax', amount: 0 },
      { type: 'total', amount: 499 },
    ]);
    expect(s.line_items[0]).toMatchObject({ item: { id: 'case:tiny-paid', title: 'The Paid Brooch', price: 499 }, quantity: 1 });
    expect(s.links.map((l: { type: string }) => l.type)).toContain('refund_policy');
    expect(s.ucp.payment_handlers['com.amazon.payments.network_token'][0].id).toBe('amazon_pay_network_token');
  });

  it('a guest token cannot open a checkout session', async () => {
    const { ucp } = setup();
    expect((await ucp('POST', '/checkout-sessions', 'service', createBody, 'k-guest')).status).toBe(401);
  });

  it('a request without an Idempotency-Key is rejected', async () => {
    const { ucp } = setup();
    expect((await ucp('POST', '/checkout-sessions', 'hh-alice', createBody)).status).toBe(400);
  });

  it('complete with demo token grants entitlement and start_case then opens paid case', async () => {
    const { deps, ucp } = setup();
    const s = await (await ucp('POST', '/checkout-sessions', 'hh-alice', createBody, 'k2')).json();
    const done = await ucp('POST', `/checkout-sessions/${s.id}/complete`, 'hh-alice', demoCard(), 'k3');
    expect(done.status).toBe(200);
    const completed = await done.json();
    expect(completed.status).toBe('completed');
    expect(completed.order.id).toMatch(/^ord_/);
    expect(await deps.entitlements.has('alice', 'case:tiny-paid')).toBe(true);

    const client = await connect(deps, userAuth('alice'));
    const r = await client.callTool({ name: 'start_case', arguments: { case_id: 'The Paid Brooch' } });
    expect(view<CaseIntroView>(r).kind).toBe('case-intro');
  });

  it('same Idempotency-Key and body replays original response', async () => {
    const { deps, ucp } = setup();
    const s = await (await ucp('POST', '/checkout-sessions', 'hh-alice', createBody, 'k4')).json();
    const first = await (await ucp('POST', `/checkout-sessions/${s.id}/complete`, 'hh-alice', demoCard(), 'k5')).json();
    const replay = await ucp('POST', `/checkout-sessions/${s.id}/complete`, 'hh-alice', demoCard(), 'k5');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(first);
    expect(await deps.entitlements.consume('alice', 'case:tiny-paid')).toBe(true);
    expect(await deps.entitlements.consume('alice', 'case:tiny-paid')).toBe(false);
  });

  it('same Idempotency-Key different body is 409', async () => {
    const { ucp } = setup();
    await ucp('POST', '/checkout-sessions', 'hh-alice', createBody, 'k6');
    const res = await ucp('POST', '/checkout-sessions', 'hh-alice', { line_items: [{ item: { id: 'custom-case' }, quantity: 1 }] }, 'k6');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'idempotency_conflict' });
  });

  it('declined token leaves no entitlement', async () => {
    const { deps, ucp } = setup();
    const s = await (await ucp('POST', '/checkout-sessions', 'hh-alice', createBody, 'k7')).json();
    const res = await ucp('POST', `/checkout-sessions/${s.id}/complete`, 'hh-alice', demoCard('tok_real_card'), 'k8');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('incomplete');
    expect(body.messages[0]).toMatchObject({ type: 'error', code: 'payment_failed', severity: 'recoverable' });
    expect(await deps.entitlements.has('alice', 'case:tiny-paid')).toBe(false);
  });

  it("another household cannot read or complete someone else's session", async () => {
    const { ucp } = setup();
    const s = await (await ucp('POST', '/checkout-sessions', 'hh-alice', createBody, 'k9')).json();
    expect((await ucp('GET', `/checkout-sessions/${s.id}`, 'hh-bob')).status).toBe(404);
    expect((await ucp('POST', `/checkout-sessions/${s.id}/complete`, 'hh-bob', demoCard(), 'k10')).status).toBe(404);
  });

  it('buy_case returns a purchase card with the session and a read-back', async () => {
    const { deps } = setup();
    const client = await connect(deps, userAuth('alice'));
    const r = await client.callTool({ name: 'buy_case', arguments: { case_id: 'the paid brooch' } });
    const v = view<PurchaseView>(r);
    expect(v).toMatchObject({ kind: 'purchase', sku: 'case:tiny-paid', priceCents: 499, currency: 'USD' });
    expect(v.checkoutSessionId).toMatch(/^cs_/);
    expect(text(r)).toBe('"The Paid Brooch" is $4.99. Want me to buy it?');
    expect(await deps.checkouts.get(v.checkoutSessionId)).toMatchObject({ householdId: 'alice', status: 'ready_for_complete' });
  });
});
