import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { ProgressView } from '@alibi/canon';
import { viewUri } from '../apps/registry.js';
import { moderate } from '../custom/moderation.js';
import type { Job } from '../store/types.js';
import { CUSTOM_CASE_SKU, openSession, resolveSku } from '../ucp/sessions.js';
import { purchaseView } from './buy.js';
import { householdOf, say, type Ctx } from './common.js';
import { LINK_FIRST } from './lab.js';

export const DAILY_PER_HOUSEHOLD = 1;
export const DAILY_GLOBAL = 15;

const jobView = (job: Job): ProgressView['jobs'][number] => ({
  jobId: job.jobId,
  stage: job.stage,
  percent: job.percent,
  status: job.status,
  ...(job.caseId ? { caseId: job.caseId } : {}),
});

function jobText(job: Job): string {
  switch (job.status) {
    case 'queued':
      return "I'm writing your case now. It usually takes about ten minutes; I'll let you know when it's ready.";
    case 'running':
      return `Your case is being written: ${job.percent}% done (${job.stage}).`;
    case 'done':
      return 'Your custom case is ready. Say "list cases" to find it.';
    case 'failed':
      return "Something went wrong writing that case. Your credit is safe; ask me to try again.";
  }
}

export function registerCustomTools(server: McpServer, ctx: Ctx): void {
  registerAppTool(
    server,
    'create_custom_case',
    {
      title: 'Write a custom case',
      description:
        "Commissions a brand-new Alibi case starring the household (names they choose), for an occasion they pick. Writing takes several minutes and runs in the background; costs one custom-case credit ($14.99).",
      inputSchema: z.object({
        names: z.array(z.string().min(1).max(30)).max(5).describe('First names of the people who should appear as characters (1 to 5)'),
        occasion: z.string().max(80).optional().describe('e.g. "Grandma Ada\'s 80th birthday"'),
        setting: z.string().max(80).optional().describe('e.g. "a lake house in Minnesota"'),
        tone: z.enum(['cozy', 'classic', 'noir']).optional(),
        rating: z.enum(['family', 'teen']).optional(),
      }),
      _meta: { ui: { resourceUri: viewUri('progress') } },
    },
    async ({ names, occasion, setting, tone, rating }) => {
      const hh = householdOf(ctx.authInfo);
      if (!hh) return say(LINK_FIRST);
      if (names.length === 0) return say('Who should be in it? Tell me up to five first names, and the occasion if there is one.');

      const check = moderate([...names, occasion ?? '', setting ?? '']);
      if (!check.ok) return say(`I can't use ${check.reason === 'language' ? 'some of those words' : check.reason} in a case. Try different names or details.`);

      if (ctx.deps.demoMode) {
        const [mine, everyone] = await Promise.all([ctx.deps.jobs.countToday(`custom:${hh}`), ctx.deps.jobs.countToday('custom:global')]);
        if (mine >= DAILY_PER_HOUSEHOLD || everyone >= DAILY_GLOBAL) {
          return say('The case writers are booked up for today. Try again tomorrow, or play one of the ready-made cases.');
        }
      }

      if (!(await ctx.deps.entitlements.consume(hh, CUSTOM_CASE_SKU))) {
        const sku = (await resolveSku(ctx.deps, CUSTOM_CASE_SKU, hh))!;
        const session = await openSession(ctx.deps, sku, hh);
        return say('A custom case is $14.99. Want me to buy one?', purchaseView(ctx, sku, session.id));
      }

      const now = ctx.deps.clock();
      const job: Job = {
        jobId: ctx.deps.newId('job'),
        householdId: hh,
        status: 'queued',
        stage: 'queued',
        percent: 0,
        input: { names, occasion, setting, tone: tone ?? 'cozy', rating: rating ?? 'family' },
        createdAt: now,
        updatedAt: now,
      };
      await ctx.deps.jobs.create(job);
      if (ctx.deps.demoMode) {
        await Promise.all([ctx.deps.jobs.incrementToday(`custom:${hh}`), ctx.deps.jobs.incrementToday('custom:global')]);
      }
      await ctx.deps.dispatcher.enqueueCasegen(job.jobId);

      const view: ProgressView = { kind: 'progress', games: [], labsReady: [], jobs: [jobView(job)], inbox: [] };
      return say(jobText(job), view);
    },
  );

  registerAppTool(
    server,
    'check_custom_case',
    {
      title: 'Custom case status',
      description: 'Reports how far along a commissioned custom case is.',
      inputSchema: z.object({ job_id: z.string() }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: viewUri('progress') } },
    },
    async ({ job_id }) => {
      const hh = householdOf(ctx.authInfo);
      if (!hh) return say(LINK_FIRST);
      const job = await ctx.deps.jobs.get(job_id);
      if (!job || job.householdId !== hh) return say("I can't find that case order. Say \"my progress\" to see everything in the works.");
      const view: ProgressView = { kind: 'progress', games: [], labsReady: [], jobs: [jobView(job)], inbox: [] };
      return say(jobText(job), view);
    },
  );
}
