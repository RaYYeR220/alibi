import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  anchorFor,
  newGameState,
  normalize,
  suspectCard,
  type Case,
  type CaseIntroView,
  type CatalogItem,
  type CatalogView,
  type GameState,
} from '@alibi/canon';
import { viewUri } from '../apps/registry.js';
import type { CaseMeta } from '../store/types.js';
import { anchorRef, assetUrl, cardWithAssets, householdOf, say, type Ctx } from './common.js';

const price = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function owns(ctx: Ctx, meta: CaseMeta): Promise<boolean> {
  if (meta.priceCents === 0 || meta.custom) return true;
  const hh = householdOf(ctx.authInfo);
  return hh ? ctx.deps.entitlements.has(hh, `case:${meta.id}`) : false;
}

async function catalogItem(ctx: Ctx, meta: CaseMeta, games: GameState[]): Promise<CatalogItem> {
  const mine = games.filter((g) => g.caseId === meta.id);
  const status = mine.some((g) => g.status === 'active') ? 'in_progress' : mine.some((g) => g.status === 'solved') ? 'solved' : 'new';
  return {
    caseId: meta.id,
    title: meta.title,
    tagline: meta.tagline,
    cover: assetUrl(ctx.deps, meta.id, meta.cover),
    priceCents: meta.priceCents,
    owned: await owns(ctx, meta),
    rating: meta.rating,
    minutes: meta.minutes,
    status,
  };
}

async function findCase(ctx: Ctx, raw: string): Promise<{ meta: CaseMeta; c: Case } | { metas: CaseMeta[] }> {
  const hh = householdOf(ctx.authInfo);
  const metas = await ctx.deps.cases.list(hh);
  const q = normalize(raw);
  const meta =
    metas.find((m) => m.id === raw) ??
    metas.find((m) => normalize(m.title) === q) ??
    metas.find((m) => normalize(m.title).replace(/^the /, '') === q.replace(/^the /, '')) ??
    metas.find((m) => q.length >= 4 && normalize(m.title).includes(q));
  if (!meta) return { metas };
  const c = await ctx.deps.cases.get(meta.id, hh);
  return c ? { meta, c } : { metas };
}

function introText(c: Case, s: GameState, resumed: boolean): string {
  const coldOpen = anchorFor(c, 'cold_open');
  const cast = c.suspects.map((x) => `${x.name}, the ${x.role}`).join('; ');
  const places = c.places.map((p) => p.name).join(', ');
  return [
    resumed ? `Picking up "${c.meta.title}" where you left off.` : coldOpen?.text ?? c.meta.setting,
    `You're the detective on "${c.meta.title}". The suspects: ${cast}. Question any of them, search ${places}, show them what you find, send items to the lab, and accuse someone when you're sure.`,
    `game_id: ${s.gameId} (pass it to every Alibi tool for this case).`,
  ].join('\n');
}

export function registerCatalogTools(server: McpServer, ctx: Ctx): void {
  registerAppTool(
    server,
    'list_cases',
    {
      title: 'List cases',
      description: 'Lists the Alibi detective cases this household can play or buy. Use when the player asks what cases there are.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: viewUri('catalog') } },
    },
    async () => {
      const hh = householdOf(ctx.authInfo);
      const games = hh ? await ctx.deps.games.listByHousehold(hh) : [];
      const metas = (await ctx.deps.cases.list(hh)).slice(0, 5);
      const items = await Promise.all(metas.map((m) => catalogItem(ctx, m, games)));
      const view: CatalogView = { kind: 'catalog', items };
      const lines = items.map((i) => `${i.title}: ${i.tagline} (${i.owned ? (i.priceCents ? 'owned' : 'free') : price(i.priceCents)})`);
      return say(`Alibi cases:\n${lines.join('\n')}\nSay "open" and a case name to start.`, view);
    },
  );

  registerAppTool(
    server,
    'start_case',
    {
      title: 'Start a case',
      description:
        'Opens an Alibi detective case (or resumes the household\'s game in it) and returns the cold open, the suspects and a game_id. Narrate the result, then let the player investigate.',
      inputSchema: z.object({ case_id: z.string().describe('Case id or title, e.g. "The Brooch at Ashby House"') }),
      _meta: { ui: { resourceUri: viewUri('case-intro') } },
    },
    async ({ case_id }) => {
      const found = await findCase(ctx, case_id);
      if ('metas' in found) {
        return say(`There's no case called "${case_id}". Available: ${found.metas.map((m) => m.title).join(', ')}.`);
      }
      const { meta, c } = found;
      const hh = householdOf(ctx.authInfo);
      if (!(await owns(ctx, meta))) {
        const item = await catalogItem(ctx, meta, []);
        return say(
          `"${meta.title}" is a paid case (${price(meta.priceCents)}). Say "buy ${meta.title}" to get it.`,
          { kind: 'catalog', items: [item] } satisfies CatalogView,
        );
      }

      const now = ctx.deps.clock();
      const existing = hh ? (await ctx.deps.games.listByHousehold(hh)).find((g) => g.caseId === meta.id && g.status === 'active') : undefined;
      const s = existing ?? newGameState(c, ctx.deps.newId('g'), hh, now);
      if (!existing) await ctx.deps.games.create(s);

      const coldOpen = anchorFor(c, 'cold_open');
      const view: CaseIntroView = {
        kind: 'case-intro',
        gameId: s.gameId,
        caseId: c.meta.id,
        title: c.meta.title,
        setting: c.meta.setting,
        cover: assetUrl(ctx.deps, c.meta.id, c.meta.cover),
        victim: { name: c.victim.name, role: c.victim.role },
        suspects: c.suspects.map((x) => cardWithAssets(ctx.deps, c.meta.id, suspectCard(c, s, x.id))),
        topics: c.topics.map((t) => ({ id: t.id, label: t.label })),
        places: c.places.map((p) => ({ id: p.id, name: p.name })),
        ...(coldOpen && !existing ? { coldOpen: anchorRef(ctx.deps, c.meta.id, coldOpen) } : {}),
        resumed: Boolean(existing),
      };
      return say(introText(c, s, Boolean(existing)), view);
    },
  );
}
