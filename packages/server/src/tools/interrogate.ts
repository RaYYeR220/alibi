import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  ask,
  evidenceItem,
  lookup,
  present,
  renderBrief,
  suspectCard,
  type ConfrontationView,
  type InterrogationView,
} from '@alibi/canon';
import { viewUri } from '../apps/registry.js';
import {
  act,
  anchorRef,
  CASE_CLOSED,
  cardWithAssets,
  evidenceWithAssets,
  gameIdArg,
  NO_SUCH_GAME,
  openGame,
  pick,
  say,
  type Ctx,
} from './common.js';

export function registerInterrogationTools(server: McpServer, ctx: Ctx): void {
  registerAppTool(
    server,
    'ask_suspect',
    {
      title: 'Question a suspect',
      description:
        "Puts the player's question to one suspect in an Alibi case. Pass the player's words verbatim. The result is a performance brief: answer in that suspect's voice using only its statements, and never add facts of your own.",
      inputSchema: z.object({
        game_id: z.string().optional().describe(gameIdArg),
        suspect: z.string().describe('Suspect name as the player said it, e.g. "the butler" or "Clara"'),
        topic: z.string().optional().describe('Optional topic label or id if the player named one'),
        question: z.string().max(500).describe("The player's question, verbatim"),
      }),
      _meta: { ui: { resourceUri: viewUri('interrogation') } },
    },
    async ({ game_id, suspect, topic, question }) => {
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      if (game.s.status !== 'active') return say(CASE_CLOSED);
      const who = pick(game.c, 'suspect', suspect);
      if ('miss' in who) return who.miss;
      const topicId = topic ? (pick(game.c, 'topic', topic) as { id?: string }).id : undefined;
      const { c } = game;
      const l = lookup(c);
      const deflection = () => say(`${l.suspect.get(who.id)!.name} has nothing to say about that and deflects in character.`);

      return act(
        ctx,
        game,
        (s) => {
          const { state, packet } = ask(c, s, { suspectId: who.id, topicId, question }, ctx.deps.clock());
          const view: InterrogationView = {
            kind: 'interrogation',
            gameId: state.gameId,
            suspect: cardWithAssets(ctx.deps, c.meta.id, suspectCard(c, state, who.id)),
            topic: packet.topicId ? { id: packet.topicId, label: l.topic.get(packet.topicId)!.label } : null,
            statements: [
              ...packet.says.map((x) => ({ text: x.text, kind: 'fact' as const, contradicted: false })),
              ...packet.claims.map((x) => ({
                text: x.text,
                kind: 'claim' as const,
                contradicted: state.knownFacts.includes(l.lie.get(x.lieId)!.contradicts),
              })),
            ],
            deflected: packet.deflect,
            ...(packet.anchor ? { anchor: anchorRef(ctx.deps, c.meta.id, packet.anchor) } : {}),
          };
          return { state, result: say(renderBrief(c, packet), view), allowedNow: packet.says.map((x) => x.factId) };
        },
        deflection,
      );
    },
  );

  registerAppTool(
    server,
    'present_evidence',
    {
      title: 'Show evidence to a suspect',
      description:
        'Confronts a suspect with an item the player has found. If it breaks their story, the result contains their exact words: speak them verbatim in that voice.',
      inputSchema: z.object({
        game_id: z.string().optional().describe(gameIdArg),
        suspect: z.string().describe('Suspect name as the player said it'),
        evidence: z.string().describe('The item, as the player named it'),
      }),
      _meta: { ui: { resourceUri: viewUri('confrontation') } },
    },
    async ({ game_id, suspect, evidence }) => {
      const game = await openGame(ctx, game_id);
      if (!game) return say(NO_SUCH_GAME);
      if (game.s.status !== 'active') return say(CASE_CLOSED);
      const { c } = game;
      const who = pick(c, 'suspect', suspect);
      if ('miss' in who) return who.miss;
      const what = pick(c, 'evidence', evidence, game.s);
      if ('miss' in what) return what.miss;
      const name = lookup(c).suspect.get(who.id)!.name;

      return act(
        ctx,
        game,
        (s) => {
          const { state, result } = present(c, s, { suspectId: who.id, evidenceId: what.id }, ctx.deps.clock());
          const found = state.discovered.includes(what.id);
          const item = found ? evidenceWithAssets(ctx.deps, c.meta.id, evidenceItem(c, state, what.id, ctx.deps.clock())) : null;
          const view: ConfrontationView = {
            kind: 'confrontation',
            gameId: state.gameId,
            suspect: cardWithAssets(ctx.deps, c.meta.id, suspectCard(c, state, who.id)),
            evidence: item,
            outcome: result.outcome,
            ...(result.anchor ? { anchor: anchorRef(ctx.deps, c.meta.id, result.anchor) } : {}),
            unlocked: result.unlockedFactIds.map((f) => lookup(c).fact.get(f)!.text),
          };
          const text = {
            cracked: `${name}'s story breaks. Say exactly, in ${name}'s voice: "${result.anchor?.text ?? ''}"`,
            not_found: "You haven't found anything like that yet.",
            no_effect: `${name} looks at the ${item?.name ?? 'item'} and shrugs. It doesn't shake their story.`,
            already: `You've already shown ${name} the ${item?.name ?? 'item'}.`,
          }[result.outcome];
          return { state, result: say(text, view), allowedNow: result.unlockedFactIds };
        },
        () => say(`${name} says nothing.`),
      );
    },
  );
}
