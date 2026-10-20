import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { accuse, GameError, lookup, type VerdictView } from '@alibi/canon';
import { viewUri } from '../apps/registry.js';
import { act, anchorRef, CASE_CLOSED, gameIdArg, NO_SUCH_GAME, openGame, pick, say, type Ctx } from './common.js';

export function registerAccuseTool(server: McpServer, ctx: Ctx): void {
  registerAppTool(
    server,
    'accuse',
    {
      title: 'Accuse a suspect',
      description:
        'Formally accuses a suspect in an Alibi case, citing the evidence that proves it. Confirm the accusation with the player first: two wrong accusations close the case.',
      inputSchema: z.object({
        game_id: z.string().optional().describe(gameIdArg),
        suspect: z.string().describe('Who the player accuses'),
        motive: z.string().optional().describe('The motive in the player\'s words, if given'),
        means: z.string().optional().describe('How they did it, in the player\'s words, if given'),
        evidence: z.array(z.string()).max(6).describe('Items the player cites as proof'),
      }),
      _meta: { ui: { resourceUri: viewUri('verdict') } },
    },
    async ({ game_id, suspect, evidence }) => {
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      if (game.s.status !== 'active') return say(CASE_CLOSED);
      const { c } = game;
      const who = pick(c, 'suspect', suspect);
      if ('miss' in who) return who.miss;
      const evidenceIds = evidence.map((e) => pick(c, 'evidence', e, game.s)).flatMap((r) => ('id' in r ? [r.id] : []));

      try {
        return await act(
          ctx,
          game,
          (s) => {
            const { state, verdict } = accuse(c, s, { suspectId: who.id, evidenceIds }, ctx.deps.clock());
            const facts = lookup(c).fact;
            const view: VerdictView = {
              kind: 'verdict',
              gameId: state.gameId,
              outcome: verdict.outcome,
              ending: anchorRef(ctx.deps, c.meta.id, verdict.ending),
              ...(verdict.confession ? { confession: anchorRef(ctx.deps, c.meta.id, verdict.confession) } : {}),
              revealed: verdict.revealedFactIds.map((f) => facts.get(f)!.text),
              score: verdict.score,
              attemptsLeft: verdict.attemptsLeft,
            };
            const lines: string[] = [];
            if (verdict.confession) lines.push(`${lookup(c).suspect.get(who.id)!.name}, in their own voice: "${verdict.confession.text}"`);
            lines.push(verdict.ending.text);
            if (verdict.outcome === 'partial') lines.push('Find the evidence that proves it, then accuse again.');
            if (verdict.outcome === 'wrong' && state.status === 'active') lines.push(`You have ${verdict.attemptsLeft} accusation left.`);
            if (state.status === 'failed') lines.push(`Case closed. What really happened: ${view.revealed.join(' ')}`);
            lines.push(`Score: ${verdict.score}.`);
            return { state, result: say(lines.join('\n'), view), allowedNow: verdict.revealedFactIds };
          },
          () => say('The accusation could not be recorded. Try again.'),
        );
      } catch (err) {
        if (err instanceof GameError) return say(CASE_CLOSED);
        throw err;
      }
    },
  );
}
