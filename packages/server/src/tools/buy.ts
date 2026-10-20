import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { normalize, type PurchaseView } from '@alibi/canon';
import { viewUri } from '../apps/registry.js';
import { openSession, resolveSku, type Sku } from '../ucp/sessions.js';
import { assetUrl, householdOf, say, type Ctx } from './common.js';
import { LINK_FIRST } from './lab.js';

const price = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function purchaseView(ctx: Ctx, sku: Sku, sessionId: string): PurchaseView {
  return {
    kind: 'purchase',
    sku: sku.sku,
    title: sku.title,
    cover: sku.caseId && sku.cover ? assetUrl(ctx.deps, sku.caseId, sku.cover) : '',
    priceCents: sku.amountCents,
    currency: 'USD',
    checkoutSessionId: sessionId,
    lineItems: [{ id: 'li_1', title: sku.title, quantity: 1, amountCents: sku.amountCents }],
    totals: [
      { type: 'subtotal', amountCents: sku.amountCents },
      { type: 'tax', amountCents: 0 },
      { type: 'total', amountCents: sku.amountCents },
    ],
  };
}

export function registerBuyTool(server: McpServer, ctx: Ctx): void {
  registerAppTool(
    server,
    'buy_case',
    {
      title: 'Buy a case',
      description:
        'Prepares the purchase of a paid Alibi case and shows its checkout card. Read the price back and ask the player to confirm; the payment itself is handled by the assistant, never by this tool.',
      inputSchema: z.object({ case_id: z.string().describe('Case id or title') }),
      _meta: { ui: { resourceUri: viewUri('purchase') } },
    },
    async ({ case_id }) => {
      const hh = householdOf(ctx.authInfo);
      if (!hh) return say(LINK_FIRST);
      const metas = await ctx.deps.cases.list(hh);
      const q = normalize(case_id);
      const meta = metas.find((m) => m.id === case_id || normalize(m.title) === q || normalize(m.title).replace(/^the /, '') === q.replace(/^the /, ''));
      if (!meta) return say(`There's no case called "${case_id}". Available: ${metas.map((m) => m.title).join(', ')}.`);
      if (meta.priceCents === 0 || meta.custom || (await ctx.deps.entitlements.has(hh, `case:${meta.id}`))) {
        return say(`You already have "${meta.title}". Say "open ${meta.title}" to play.`);
      }
      const sku = await resolveSku(ctx.deps, meta.id, hh);
      if (!sku) return say(`"${meta.title}" isn't for sale right now.`);
      const session = await openSession(ctx.deps, sku, hh);
      return say(`"${sku.title}" is ${price(sku.amountCents)}. Want me to buy it?`, purchaseView(ctx, sku, session.id));
    },
  );
}
