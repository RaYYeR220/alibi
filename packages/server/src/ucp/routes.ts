import { createHash } from 'node:crypto';
import { Hono, type Context } from 'hono';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { Deps } from '../deps.js';
import type { Verify } from '../http/gate.js';
import { householdOf } from '../tools/common.js';
import type { PaymentInstrument, PaymentProcessor } from './payment.js';
import { openSession, resolveSku, ucpSession } from './sessions.js';

interface UcpOptions {
  verify: Verify;
  /** Public origin used for policy and order links. */
  linksBase: string;
  /** Chosen explicitly by the deployment; there is no default. */
  processor: PaymentProcessor;
}

type Reply = { status: number; body: unknown };

const json = (c: Context, r: Reply) => {
  c.header('Cache-Control', 'no-store');
  const requestId = c.req.header('request-id');
  if (requestId) c.header('Request-Id', requestId);
  return c.json(r.body as object, r.status as 200);
};

/**
 * UCP checkout endpoints (2026-04-08) that Alexa+ calls directly during the
 * payment phase. Every mutation is idempotent per caller and Idempotency-Key.
 */
export function ucpRoutes(deps: Deps, opts: UcpOptions): Hono {
  const app = new Hono();
  const processor = opts.processor;

  const auth = async (c: Context): Promise<AuthInfo | null> => {
    const m = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
    if (!m) return null;
    try {
      return await opts.verify(m[1]!.trim());
    } catch {
      return null;
    }
  };

  /** Runs a mutation once per (caller, key); replays the stored reply for an identical retry. */
  const idempotent = async (c: Context, authInfo: AuthInfo, raw: string, run: () => Promise<Reply>) => {
    const key = c.req.header('idempotency-key');
    if (!key) return json(c, { status: 400, body: { code: 'idempotency_key_required', content: 'Idempotency-Key header is required' } });
    const owner = `${authInfo.clientId}|${householdOf(authInfo) ?? '-'}`;
    const hash = createHash('sha256').update(`${c.req.method} ${c.req.path}\n${raw}`).digest('hex');
    const prior = await deps.checkouts.getIdem(owner, key);
    if (prior) {
      if (prior.bodyHash !== hash) {
        return json(c, { status: 409, body: { code: 'idempotency_conflict', content: 'Key was used with a different request body' } });
      }
      return json(c, { status: prior.status, body: prior.response });
    }
    const reply = await run();
    if (reply.status < 500) await deps.checkouts.putIdem(owner, key, { bodyHash: hash, status: reply.status, response: reply.body });
    return json(c, reply);
  };

  const ownSession = async (authInfo: AuthInfo, id: string) => {
    const s = await deps.checkouts.get(id);
    return s && s.householdId === householdOf(authInfo) ? s : null;
  };

  const notFound: Reply = { status: 404, body: { code: 'not_found', content: 'No such checkout session' } };

  app.post('/checkout-sessions', async (c) => {
    const authInfo = await auth(c);
    const hh = householdOf(authInfo ?? undefined);
    // Cases are owned by a household, so buying one needs a linked account.
    if (!authInfo || !hh) return new Response(null, { status: 401 });
    const raw = await c.req.text();
    return idempotent(c, authInfo, raw, async () => {
      let body: { line_items?: { item?: { id?: string } }[] };
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return { status: 400, body: { code: 'invalid_json', content: 'Body is not JSON' } };
      }
      const requested = body.line_items?.[0]?.item?.id;
      const sku = requested ? await resolveSku(deps, requested, hh) : null;
      if (!sku) return { status: 400, body: { code: 'invalid_item', content: 'Unknown or free item' } };
      const session = await openSession(deps, sku, hh);
      return { status: 201, body: ucpSession(session, opts.linksBase) };
    });
  });

  app.get('/checkout-sessions/:id', async (c) => {
    const authInfo = await auth(c);
    if (!authInfo) return new Response(null, { status: 401 });
    const s = await ownSession(authInfo, c.req.param('id'));
    return json(c, s ? { status: 200, body: ucpSession(s, opts.linksBase) } : notFound);
  });

  // Digital goods: nothing to fulfil or re-price, so an update returns the current state.
  app.put('/checkout-sessions/:id', async (c) => {
    const authInfo = await auth(c);
    if (!authInfo) return new Response(null, { status: 401 });
    const s = await ownSession(authInfo, c.req.param('id'));
    return json(c, s ? { status: 200, body: ucpSession(s, opts.linksBase) } : notFound);
  });

  app.post('/checkout-sessions/:id/complete', async (c) => {
    const authInfo = await auth(c);
    if (!authInfo) return new Response(null, { status: 401 });
    const raw = await c.req.text();
    return idempotent(c, authInfo, raw, async () => {
      const s = await ownSession(authInfo, c.req.param('id'));
      if (!s) return notFound;
      if (s.status === 'completed' || s.status === 'canceled') return { status: 200, body: ucpSession(s, opts.linksBase) };
      let instrument: PaymentInstrument | undefined;
      try {
        instrument = (JSON.parse(raw || '{}') as { payment?: { instruments?: PaymentInstrument[] } }).payment?.instruments?.[0];
      } catch {
        instrument = undefined;
      }
      if (!instrument) {
        return { status: 200, body: ucpSession(s, opts.linksBase, [{ type: 'error', code: 'missing', content: 'A payment instrument is required', severity: 'recoverable', path: '$.payment.instruments' }]) };
      }
      const charge = await processor.charge({ sessionId: s.id, amountCents: s.amountCents, instrument }, deps.newId);
      if (!charge.ok) {
        const declined = { ...s, status: 'incomplete' as const, updatedAt: deps.clock() };
        await deps.checkouts.put(declined);
        return { status: 200, body: ucpSession(declined, opts.linksBase, [{ type: 'error', code: charge.code, content: charge.content, severity: 'recoverable' }]) };
      }
      const done = { ...s, status: 'completed' as const, orderId: charge.orderId, updatedAt: deps.clock() };
      await deps.entitlements.grant(s.householdId!, s.sku, charge.orderId);
      await deps.checkouts.put(done);
      return { status: 200, body: ucpSession(done, opts.linksBase) };
    });
  });

  app.post('/checkout-sessions/:id/cancel', async (c) => {
    const authInfo = await auth(c);
    if (!authInfo) return new Response(null, { status: 401 });
    const raw = await c.req.text();
    return idempotent(c, authInfo, raw, async () => {
      const s = await ownSession(authInfo, c.req.param('id'));
      if (!s) return notFound;
      if (s.status === 'completed') return { status: 200, body: ucpSession(s, opts.linksBase) };
      const canceled = { ...s, status: 'canceled' as const, updatedAt: deps.clock() };
      await deps.checkouts.put(canceled);
      return { status: 200, body: ucpSession(canceled, opts.linksBase) };
    });
  });

  return app;
}
