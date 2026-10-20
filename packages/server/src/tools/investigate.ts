import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  board,
  evidenceItem,
  examine,
  GameError,
  hint,
  lookup,
  type BoardView,
  type EvidenceView,
  type HintView,
} from '@alibi/canon';
import { viewUri } from '../apps/registry.js';
import { act, CASE_CLOSED, cardWithAssets, evidenceWithAssets, gameIdArg, NO_SUCH_GAME, openGame, say, type Ctx } from './common.js';

export function registerInvestigationTools(server: McpServer, ctx: Ctx): void {
  registerAppTool(
    server,
    'examine',
    {
      title: 'Search a place or look at an item',
      description: 'Searches a place in an Alibi case for evidence, or looks again at an item the player already found.',
      inputSchema: z.object({
        game_id: z.string().optional().describe(gameIdArg),
        target: z.string().describe('A place ("the study") or an item the player found'),
      }),
      _meta: { ui: { resourceUri: viewUri('evidence') } },
    },
    async ({ game_id, target }) => {
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      if (game.s.status !== 'active') return say(CASE_CLOSED);
      const { c } = game;
      try {
        return await act(
          ctx,
          game,
          (s) => {
            const now = ctx.deps.clock();
            const { state, result } = examine(c, s, { target }, now);
            const place = result.placeId ? c.places.find((p) => p.id === result.placeId) : undefined;
            const items = result.found.map((e) => evidenceWithAssets(ctx.deps, c.meta.id, evidenceItem(c, state, e.id, now)));
            const view: EvidenceView = {
              kind: 'evidence',
              gameId: state.gameId,
              ...(place ? { place: { id: place.id, name: place.name } } : {}),
              found: items,
              nothingNew: result.nothingNew,
            };
            const labNote = items.filter((i) => i.lab === 'available').map((i) => `The lab could analyse the ${i.name}.`);
            const text = items.length
              ? [`${place ? `In ${place.name} you find` : 'You look again at'}: ${items.map((i) => `${i.name}. ${i.description}`).join(' ')}`, ...labNote].join(' ')
              : place
                ? `Nothing new in ${place.name}.`
                : "You haven't found anything like that yet.";
            return { state, result: say(text, view) };
          },
          () => say('You find nothing new.'),
        );
      } catch (err) {
        if (err instanceof GameError) return say(`There's no "${target}" to search. Places: ${err.choices.join(', ')}.`);
        throw err;
      }
    },
  );

  registerAppTool(
    server,
    'get_case_board',
    {
      title: 'Evidence board',
      description: "Shows the Alibi case board: everything found, every statement heard, and which stories don't add up. Read a short summary aloud.",
      inputSchema: z.object({ game_id: z.string().optional().describe(gameIdArg) }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: viewUri('board') } },
    },
    async ({ game_id }) => {
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      const { c, s } = game;
      const b = board(c, s, ctx.deps.clock());
      const view: BoardView = {
        ...b,
        suspects: b.suspects.map((x) => ({ ...cardWithAssets(ctx.deps, c.meta.id, x), statements: x.statements })),
        evidence: b.evidence.map((e) => evidenceWithAssets(ctx.deps, c.meta.id, e)),
      };
      const name = (id: string) => lookup(c).suspect.get(id)!.name;
      const parts = [
        b.evidence.length ? `Evidence: ${b.evidence.map((e) => e.name).join(', ')}.` : 'No evidence found yet.',
        ...b.contradictions.map((x) => `${name(x.suspectId)} said "${x.claim}" but ${x.conflictsWith}${x.resolved ? ' (they admitted it)' : ''}.`),
        `Score: ${b.score}.`,
      ];
      return say(parts.join(' '), view);
    },
  );

  registerAppTool(
    server,
    'get_hint',
    {
      title: 'Get a hint',
      description: 'Gives the player a nudge toward the next step in an Alibi case. Each hint costs 50 points.',
      inputSchema: z.object({ game_id: z.string().optional().describe(gameIdArg) }),
      _meta: { ui: { resourceUri: viewUri('hint') } },
    },
    async ({ game_id }) => {
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      if (game.s.status !== 'active') return say(CASE_CLOSED);
      return act(
        ctx,
        game,
        (s) => {
          const { state, hint: h } = hint(game.c, s);
          const view: HintView = { kind: 'hint', gameId: state.gameId, level: h.level, text: h.text };
          return { state, result: say(h.text, view) };
        },
        () => say('Keep going: question everyone, and search every room.'),
      );
    },
  );
}
