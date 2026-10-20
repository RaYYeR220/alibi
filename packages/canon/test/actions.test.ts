import { describe, expect, it } from 'vitest';
import { accuse } from '../src/engine/accuse.js';
import { ask, GameError } from '../src/engine/ask.js';
import { board } from '../src/engine/board.js';
import { examine } from '../src/engine/examine.js';
import { hint } from '../src/engine/hint.js';
import { collectLab, requestLab } from '../src/engine/lab.js';
import { present } from '../src/engine/present.js';
import type { GameState } from '../src/state.js';
import { fresh, tinyCase } from './helpers.js';

const c = tinyCase();
const HOUR = 3_600_000;

function search(s: GameState, ...places: string[]): GameState {
  for (const p of places) s = examine(c, s, { target: p }, 0).state;
  return s;
}

describe('examine', () => {
  it('searching a place reveals the evidence there once', () => {
    const first = examine(c, fresh(c), { target: 'the study' }, 0);
    expect(first.result.placeId).toBe('study');
    expect(first.result.found.map((e) => e.id).sort()).toEqual(['e_handkerchief', 'e_muddy_prints']);
    expect(first.state.discovered).toEqual(expect.arrayContaining(['e_handkerchief', 'e_muddy_prints']));
    const again = examine(c, first.state, { target: 'study' }, 0);
    expect(again.result.found).toEqual([]);
    expect(again.result.nothingNew).toBe(true);
  });

  it('evidence that implies a fact makes it known', () => {
    const { state } = examine(c, fresh(c), { target: 'hall' }, 0);
    expect(state.discovered).toContain('e_pawn_ticket');
    expect(state.knownFacts).toContain('f_clara_debts');
  });

  it('naming undiscovered evidence reveals nothing about it', () => {
    const { result } = examine(c, fresh(c), { target: 'handkerchief' }, 0);
    expect(result.found).toEqual([]);
    expect(result.nothingNew).toBe(true);
  });

  it('an unknown target lists the places', () => {
    expect(() => examine(c, fresh(c), { target: 'the moon' }, 0)).toThrow(GameError);
  });
});

describe('present', () => {
  it('presenting exposing evidence cracks the lie and returns crack anchor', () => {
    const s = search(fresh(c), 'study');
    const { state, result } = present(c, s, { suspectId: 'clara', evidenceId: 'e_handkerchief' }, 0);
    expect(result.outcome).toBe('cracked');
    expect(result.brokenLieIds).toEqual(['l_clara']);
    expect(result.anchor?.id).toBe('a_clara_crack');
    expect(result.unlockedFactIds).toContain('f_clara_study');
    expect(state.knownFacts).toContain('f_clara_study');
    expect(state.brokenLies).toContain('l_clara');
  });

  it('presenting undiscovered evidence returns not_found without description', () => {
    const { result } = present(c, fresh(c), { suspectId: 'clara', evidenceId: 'e_handkerchief' }, 0);
    expect(result.outcome).toBe('not_found');
    expect(JSON.stringify(result)).not.toMatch(/lilies|lace/i);
  });

  it('presenting twice returns already and does not double-unlock', () => {
    const s = search(fresh(c), 'study');
    const once = present(c, s, { suspectId: 'harold', evidenceId: 'e_muddy_prints' }, 0);
    const twice = present(c, once.state, { suspectId: 'harold', evidenceId: 'e_muddy_prints' }, 0);
    expect(twice.result.outcome).toBe('already');
    expect(twice.result.unlockedFactIds).toEqual([]);
    expect(twice.state.knownFacts.filter((f) => f === 'f_harold_twine')).toHaveLength(1);
    expect(twice.state.score).toBe(once.state.score);
  });

  it('irrelevant evidence has no effect', () => {
    const s = search(fresh(c), 'study');
    expect(present(c, s, { suspectId: 'perkins', evidenceId: 'e_muddy_prints' }, 0).result.outcome).toBe('no_effect');
  });
});

describe('lab', () => {
  it('lab result is not ready before availableAt and ready after clock offset', () => {
    let s = search(fresh(c), 'dining room');
    const req = requestLab(c, s, { evidenceId: 'e_desk_key' }, 0);
    expect(req.ticket.availableAt).toBe(14 * HOUR);
    s = req.state;
    expect(collectLab(c, s, 13 * HOUR).results).toEqual([]);
    const later = collectLab(c, { ...s, clockOffsetMs: 14 * HOUR }, 0);
    expect(later.results).toEqual([{ evidenceId: 'e_desk_key', factIds: ['f_key_perfume'] }]);
    expect(later.state.knownFacts).toContain('f_key_perfume');
    expect(collectLab(c, later.state, 0).results).toEqual([]);
  });

  it('only lab-testable, discovered evidence can be sent', () => {
    const s = search(fresh(c), 'study');
    expect(() => requestLab(c, s, { evidenceId: 'e_muddy_prints' }, 0)).toThrow(/not_lab_testable|lab/);
    expect(() => requestLab(c, fresh(c), { evidenceId: 'e_desk_key' }, 0)).toThrow(GameError);
  });
});

describe('accuse', () => {
  it('wrong accusation reveals nothing; second wrong fails the game', () => {
    const first = accuse(c, fresh(c), { suspectId: 'harold', evidenceIds: [] }, 0);
    expect(first.verdict.outcome).toBe('wrong');
    expect(first.verdict.revealedFactIds).toEqual([]);
    expect(first.state.status).toBe('active');
    const second = accuse(c, first.state, { suspectId: 'perkins', evidenceIds: [] }, 0);
    expect(second.state.status).toBe('failed');
    expect(second.verdict.revealedFactIds).toContain('f_clara_took');
    expect(() => accuse(c, second.state, { suspectId: 'clara', evidenceIds: [] }, 0)).toThrow(/game_over|over/);
  });

  it('right suspect without proof is partial and the game continues', () => {
    const { verdict, state } = accuse(c, fresh(c), { suspectId: 'clara', evidenceIds: ['e_handkerchief'] }, 0);
    expect(verdict.outcome).toBe('partial');
    expect(verdict.revealedFactIds).toEqual([]);
    expect(state.status).toBe('active');
  });

  it('correct accusation with proof evidence reveals solution facts', () => {
    const s = search(fresh(c), 'study');
    const { verdict, state } = accuse(c, s, { suspectId: 'clara', evidenceIds: ['e_handkerchief'] }, 0);
    expect(verdict.outcome).toBe('correct');
    expect(verdict.ending.trigger).toBe('ending_correct');
    expect(verdict.revealedFactIds).toEqual(expect.arrayContaining(['f_clara_took', 'f_clara_debts', 'f_clara_study']));
    expect(state.status).toBe('solved');
  });
});

describe('hint', () => {
  it('hint walks the minimal proof path', () => {
    let s = fresh(c);
    const h1 = hint(c, s);
    expect(h1.hint.level).toBe(1);
    expect(h1.hint.text).toMatch(/study/i);
    expect(h1.state.score).toBe(s.score - 50);
    s = search(s, 'study', 'dining room');
    s = present(c, s, { suspectId: 'clara', evidenceId: 'e_handkerchief' }, 0).state;
    const h2 = hint(c, s);
    expect(h2.hint.level).toBe(2);
    expect(h2.hint.text).toMatch(/lab/i);
    s = requestLab(c, s, { evidenceId: 'e_desk_key' }, 0).state;
    s = collectLab(c, { ...s, clockOffsetMs: 20 * HOUR }, 0).state;
    expect(hint(c, s).hint.level).toBe(3);
  });
});

describe('board', () => {
  it('collects statements, evidence and flags contradicted claims', () => {
    let s = search(fresh(c), 'study');
    s = ask(c, s, { suspectId: 'clara', topicId: 't_whereabouts' }, 0).state;
    let view = board(c, s, 0);
    const clara = view.suspects.find((x) => x.id === 'clara')!;
    expect(clara.statements.map((x) => x.kind)).toContain('claim');
    expect(view.evidence.map((e) => e.id)).toEqual(expect.arrayContaining(['e_handkerchief', 'e_muddy_prints']));
    expect(view.contradictions).toEqual([]);
    s = present(c, s, { suspectId: 'clara', evidenceId: 'e_handkerchief' }, 0).state;
    view = board(c, s, 0);
    expect(view.contradictions).toEqual([
      expect.objectContaining({ suspectId: 'clara', resolved: true }),
    ]);
  });
});
