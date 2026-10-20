import type { Case } from '../schema.js';
import { gameNow, type GameState } from '../state.js';
import type { BoardView, EvidenceItem, Statement, SuspectCard } from '../views.js';
import { demeanorFor } from './demeanor.js';
import { lookup } from './lookup.js';

export function suspectCard(c: Case, s: GameState, suspectId: string): SuspectCard {
  const suspect = lookup(c).suspect.get(suspectId)!;
  return {
    id: suspect.id,
    name: suspect.name,
    role: suspect.role,
    portrait: suspect.portrait,
    demeanor: demeanorFor(c, s, suspect.id),
    voiceId: suspect.voiceId,
  };
}

export function evidenceItem(c: Case, s: GameState, evidenceId: string, now: number): EvidenceItem {
  const e = lookup(c).evidence.get(evidenceId)!;
  const req = s.labs.find((l) => l.evidenceId === evidenceId);
  const lab: EvidenceItem['lab'] = !e.lab
    ? 'none'
    : !req
      ? 'available'
      : gameNow(s, now) >= req.availableAt
        ? 'ready'
        : 'pending';
  return { id: e.id, name: e.name, description: e.description, image: e.image, lab };
}

/** Statements a suspect has made so far, in the order they were heard. */
export function statementsBy(c: Case, s: GameState, suspectId: string): Statement[] {
  const l = lookup(c);
  const seen = new Set<string>();
  const out: Statement[] = [];
  for (const turn of s.served) {
    if (turn.suspectId !== suspectId) continue;
    for (const f of turn.factIds) {
      if (seen.has(f)) continue;
      seen.add(f);
      out.push({ text: l.fact.get(f)!.text, contradicted: false });
    }
    for (const lieId of turn.lieIds) {
      if (seen.has(lieId)) continue;
      seen.add(lieId);
      const lie = l.lie.get(lieId)!;
      out.push({ text: lie.claim, contradicted: s.knownFacts.includes(lie.contradicts) || s.brokenLies.includes(lie.id) });
    }
  }
  return out;
}

export function board(c: Case, s: GameState, now: number): BoardView {
  const l = lookup(c);
  const servedLies = new Set(s.served.flatMap((t) => t.lieIds));
  const contradictions = c.lies
    .filter((lie) => servedLies.has(lie.id) && (s.knownFacts.includes(lie.contradicts) || s.brokenLies.includes(lie.id)))
    .map((lie) => ({
      suspectId: lie.suspectId,
      claim: lie.claim,
      conflictsWith: l.fact.get(lie.contradicts)!.text,
      resolved: s.brokenLies.includes(lie.id),
    }));
  const timeline = c.facts
    .filter((f) => f.kind === 'event' && s.knownFacts.includes(f.id))
    .map((f) => ({ ...(f.time ? { time: f.time } : {}), text: f.text }));

  return {
    kind: 'board',
    gameId: s.gameId,
    title: c.meta.title,
    suspects: c.suspects.map((x) => ({ ...suspectCard(c, s, x.id), statements: statementsBy(c, s, x.id) })),
    evidence: s.discovered.map((id) => evidenceItem(c, s, id, now)),
    timeline,
    contradictions,
    status: s.status,
    score: s.score,
  };
}
