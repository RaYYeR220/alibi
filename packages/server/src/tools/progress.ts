import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { gameNow, lookup, type ProgressView } from '@alibi/canon';
import { viewUri } from '../apps/registry.js';
import { householdOf, say, type Ctx } from './common.js';
import { LINK_FIRST } from './lab.js';

export const INBOX_URI = 'alibi://household/inbox';

export async function progressView(ctx: Ctx, hh: string): Promise<ProgressView> {
  const now = ctx.deps.clock();
  const [games, jobs, inbox] = await Promise.all([
    ctx.deps.games.listByHousehold(hh),
    ctx.deps.jobs.listByHousehold(hh),
    ctx.deps.inbox.list(hh),
  ]);
  const titled = await Promise.all(
    games.map(async (g) => ({ g, c: await ctx.deps.cases.get(g.caseId, hh) })),
  );
  return {
    kind: 'progress',
    games: titled.map(({ g, c }) => ({
      gameId: g.gameId,
      caseId: g.caseId,
      title: c?.meta.title ?? g.caseId,
      status: g.status,
      updatedAt: new Date(g.updatedAt).toISOString(),
    })),
    labsReady: titled.flatMap(({ g, c }) =>
      g.labs
        .filter((l) => !l.collected && gameNow(g, now) >= l.availableAt)
        .map((l) => ({ gameId: g.gameId, evidenceId: l.evidenceId, name: c ? lookup(c).evidence.get(l.evidenceId)!.name : l.evidenceId })),
    ),
    jobs: jobs.map((j) => ({ jobId: j.jobId, stage: j.stage, percent: j.percent, status: j.status, ...(j.caseId ? { caseId: j.caseId } : {}) })),
    inbox: inbox.slice(-10).map((i) => ({ id: i.id, kind: i.kind, text: i.text, at: new Date(i.at).toISOString() })),
  };
}

export function registerProgressTools(server: McpServer, ctx: Ctx): void {
  registerAppTool(
    server,
    'my_progress',
    {
      title: 'My progress',
      description: "Summarises the household's Alibi games in progress, lab results waiting, custom cases being written and recent notifications.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: viewUri('progress') } },
    },
    async () => {
      const hh = householdOf(ctx.authInfo);
      if (!hh) return say(LINK_FIRST);
      const v = await progressView(ctx, hh);
      const active = v.games.filter((g) => g.status === 'active');
      const parts = [
        active.length ? `In progress: ${active.map((g) => g.title).join(', ')}.` : 'No case in progress.',
        ...v.labsReady.map((l) => `Lab results are in for the ${l.name}.`),
        ...v.jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => `Your custom case is ${j.percent}% written (${j.stage}).`),
        ...v.jobs.filter((j) => j.status === 'done').map(() => 'Your custom case is ready to play.'),
      ];
      return say(parts.join(' '), v);
    },
  );

  server.registerResource(
    'household-inbox',
    INBOX_URI,
    { mimeType: 'application/json', description: "The household's Alibi notifications (lab results, finished custom cases)" },
    async () => {
      const hh = householdOf(ctx.authInfo);
      const items = hh ? await ctx.deps.inbox.list(hh) : [];
      return { contents: [{ uri: INBOX_URI, mimeType: 'application/json', text: JSON.stringify(items) }] };
    },
  );
}
