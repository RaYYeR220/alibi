import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { collectLab, GameError, lookup, requestLab, type GameState, type LabView } from '@alibi/canon';
import type { Case } from '@alibi/canon';
import { viewUri } from '../apps/registry.js';
import { act, CASE_CLOSED, gameIdArg, householdOf, NO_SUCH_GAME, openGame, pick, say, type Ctx } from './common.js';

export const LINK_FIRST = 'The lab and your case file need a linked Alibi account. Link your account, then ask again.';

function labView(c: Case, s: GameState, results: { evidenceId: string; factIds: string[] }[]): LabView {
  const l = lookup(c);
  return {
    kind: 'lab',
    gameId: s.gameId,
    pending: s.labs
      .filter((x) => !x.collected)
      .map((x) => ({ evidenceId: x.evidenceId, name: l.evidence.get(x.evidenceId)!.name, readyAt: new Date(x.availableAt - s.clockOffsetMs).toISOString() })),
    results: results.map((r) => ({ evidenceId: r.evidenceId, name: l.evidence.get(r.evidenceId)!.name, findings: r.factIds.map((f) => l.fact.get(f)!.text) })),
  };
}

function when(hours: number): string {
  if (hours <= 1) return 'within the hour';
  if (hours < 10) return `in about ${Math.round(hours)} hours`;
  return 'by tomorrow morning';
}

export function registerLabTools(server: McpServer, ctx: Ctx): void {
  registerAppTool(
    server,
    'request_lab_test',
    {
      title: 'Send evidence to the lab',
      description: 'Sends an item the player found to the forensic lab. Results take real time (usually overnight); the household is notified when they are in.',
      inputSchema: z.object({
        game_id: z.string().optional().describe(gameIdArg),
        evidence: z.string().describe('The item to send, as the player named it'),
      }),
      _meta: { ui: { resourceUri: viewUri('lab') } },
    },
    async ({ game_id, evidence }) => {
      const hh = householdOf(ctx.authInfo);
      if (!hh) return say(LINK_FIRST);
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      if (game.s.status !== 'active') return say(CASE_CLOSED);
      const what = pick(game.c, 'evidence', evidence, game.s);
      if ('miss' in what) return what.miss;
      const { c } = game;
      let realAt = 0;
      try {
        const result = await act(
          ctx,
          game,
          (s) => {
            const now = ctx.deps.clock();
            const { state, ticket } = requestLab(c, s, { evidenceId: what.id }, now);
            realAt = ticket.availableAt - state.clockOffsetMs;
            const name = lookup(c).evidence.get(what.id)!.name;
            const hours = (ticket.availableAt - (now + state.clockOffsetMs)) / 3_600_000;
            return { state, result: say(`The lab has the ${name}. Results ${when(hours)}; I'll let you know when they're in.`, labView(c, state, [])) };
          },
          () => say('The lab could not take that item.'),
        );
        await ctx.deps.scheduler.schedule(hh, game.s.gameId, what.id, realAt);
        return result;
      } catch (err) {
        if (err instanceof GameError) return say(err.message.replace(/^./, (ch) => ch.toUpperCase()) + '.');
        throw err;
      }
    },
  );

  registerAppTool(
    server,
    'check_lab_results',
    {
      title: 'Check lab results',
      description: 'Collects any finished lab results for the case and reads the findings.',
      inputSchema: z.object({ game_id: z.string().optional().describe(gameIdArg) }),
      _meta: { ui: { resourceUri: viewUri('lab') } },
    },
    async ({ game_id }) => {
      if (!householdOf(ctx.authInfo)) return say(LINK_FIRST);
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      const { c } = game;
      return act(
        ctx,
        game,
        (s) => {
          const { state, results } = collectLab(c, s, ctx.deps.clock());
          const view = labView(c, state, results);
          const text = results.length
            ? view.results.map((r) => `Lab results on the ${r.name}: ${r.findings.join(' ')}`).join('\n')
            : view.pending.length
              ? `Nothing back yet. Still waiting on: ${view.pending.map((p) => p.name).join(', ')}.`
              : 'There are no lab tests waiting.';
          return { state, result: say(text, view), allowedNow: results.flatMap((r) => r.factIds) };
        },
        () => say('The lab line is busy. Try again in a moment.'),
      );
    },
  );

  if (!ctx.deps.demoMode) return;

  registerAppTool(
    server,
    'set_demo_clock',
    {
      title: 'Skip ahead (demo)',
      description: 'Demo households only: moves this game\'s clock forward, e.g. to "tomorrow morning", so overnight lab results arrive now.',
      inputSchema: z.object({
        game_id: z.string().optional().describe(gameIdArg),
        advance_hours: z.number().min(0).max(72),
      }),
      _meta: { ui: { resourceUri: viewUri('progress') } },
    },
    async ({ game_id, advance_hours }) => {
      if (!householdOf(ctx.authInfo)) return say(LINK_FIRST);
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      await ctx.deps.games.update(game.s.gameId, (s) => ({ ...s, clockOffsetMs: s.clockOffsetMs + advance_hours * 3_600_000 }));
      return say(`Skipped ahead ${advance_hours} hours.`);
    },
  );
}
