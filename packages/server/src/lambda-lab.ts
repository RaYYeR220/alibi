import { lookup } from '@alibi/canon';
import type { Deps } from './deps.js';

export interface LabReadyEvent {
  householdId: string;
  gameId: string;
  evidenceId: string;
}

/** Fired by EventBridge Scheduler when a lab result comes due. */
export async function handleLabReady(deps: Pick<Deps, 'games' | 'cases' | 'inbox' | 'clock' | 'newId'>, event: LabReadyEvent): Promise<void> {
  const game = await deps.games.get(event.gameId);
  if (!game || game.householdId !== event.householdId) return;
  const c = await deps.cases.get(game.caseId, game.householdId);
  const name = c ? lookup(c).evidence.get(event.evidenceId)?.name ?? 'evidence' : 'evidence';
  await deps.inbox.add(event.householdId, {
    id: deps.newId('in'),
    kind: 'lab_ready',
    text: `The lab results for the ${name} are in${c ? ` (${c.meta.title})` : ''}.`,
    at: deps.clock(),
    gameId: event.gameId,
    ...(c ? { caseId: c.meta.id } : {}),
  });
}
