import type { Deps } from '../deps.js';
import type { CheckoutSession } from '../store/types.js';
import { sessionHandlers, UCP_VERSION, CHECKOUT_CAPABILITY } from './profile.js';

export const CUSTOM_CASE_SKU = 'custom-case';
export const CUSTOM_CASE_PRICE_CENTS = 1499;
const SESSION_TTL_MS = 6 * 3_600_000;

export interface Sku {
  sku: string;
  title: string;
  amountCents: number;
  cover?: string;
  caseId?: string;
}

/** Prices come from the catalog, never from the request. */
export async function resolveSku(deps: Deps, raw: string, householdId: string | null): Promise<Sku | null> {
  if (raw === CUSTOM_CASE_SKU) return { sku: CUSTOM_CASE_SKU, title: 'A custom Alibi case', amountCents: CUSTOM_CASE_PRICE_CENTS };
  const caseId = raw.startsWith('case:') ? raw.slice(5) : raw;
  const c = await deps.cases.get(caseId, householdId);
  if (!c || c.meta.priceCents <= 0) return null;
  return { sku: `case:${c.meta.id}`, title: c.meta.title, amountCents: c.meta.priceCents, cover: c.meta.cover, caseId: c.meta.id };
}

export async function openSession(deps: Deps, sku: Sku, householdId: string): Promise<CheckoutSession> {
  const now = deps.clock();
  const session: CheckoutSession = {
    id: deps.newId('cs'),
    householdId,
    sku: sku.sku,
    status: 'ready_for_complete',
    currency: 'USD',
    amountCents: sku.amountCents,
    title: sku.title,
    createdAt: now,
    updatedAt: now,
  };
  await deps.checkouts.put(session);
  return session;
}

export interface UcpMessage {
  type: 'error' | 'warning' | 'info';
  code: string;
  content: string;
  severity?: 'recoverable' | 'requires_buyer_review';
  path?: string;
}

/** The UCP checkout object Alexa+ reads on every response. */
export function ucpSession(s: CheckoutSession, linksBase: string, messages: UcpMessage[] = []) {
  const amount = s.amountCents;
  return {
    id: s.id,
    status: s.status,
    currency: s.currency,
    line_items: [
      {
        id: 'li_1',
        item: { id: s.sku, title: s.title, price: amount },
        quantity: 1,
        totals: [
          { type: 'subtotal', amount },
          { type: 'total', amount },
        ],
      },
    ],
    totals: [
      { type: 'subtotal', amount },
      { type: 'tax', amount: 0 },
      { type: 'total', amount },
    ],
    ucp: {
      version: UCP_VERSION,
      capabilities: { 'dev.ucp.shopping.checkout': [{ version: CHECKOUT_CAPABILITY.version }] },
      payment_handlers: sessionHandlers(s.householdId !== null),
    },
    messages,
    links: [
      { type: 'refund_policy', title: 'Refund Policy', url: `${linksBase}/legal/refunds` },
      { type: 'terms_of_service', title: 'Terms of Service', url: `${linksBase}/legal/terms` },
    ],
    ...(s.status === 'completed' && s.orderId
      ? { order: { id: s.orderId, permalink_url: `${linksBase}/orders/${s.orderId}` } }
      : { expires_at: new Date(s.createdAt + SESSION_TTL_MS).toISOString() }),
  };
}
