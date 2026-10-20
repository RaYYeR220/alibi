#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { renderBrief } from './brief.js';
import { accuse } from './engine/accuse.js';
import { ask, GameError } from './engine/ask.js';
import { board } from './engine/board.js';
import { examine } from './engine/examine.js';
import { hint } from './engine/hint.js';
import { collectLab, requestLab } from './engine/lab.js';
import { present } from './engine/present.js';
import { lintCase } from './lint.js';
import { parseCase, type Case } from './schema.js';
import { newGameState, type GameState } from './state.js';
import { resolveEntity } from './topics.js';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = `usage:
  alibi-canon lint <case.json>
  alibi-canon playtest <case.json>`;

const HELP = `commands: ask <suspect> <question> | examine <place or item> | present <suspect> <item> | lab <item> | wait <hours> | hint | board | accuse <suspect> <item...> | quit`;

function load(file: string): Case {
  return parseCase(JSON.parse(readFileSync(file, 'utf8')));
}

function lint(file: string, io: Io): number {
  const issues = lintCase(load(file));
  for (const i of issues) io.out(`${i.code}: ${i.detail}`);
  io.out(`${issues.length} issues`);
  return issues.length ? 1 : 0;
}

/** Resolves a leading multi-word entity name ("lace handkerchief ...") and returns it with the remaining words. */
function takeEntity(c: Case, kind: 'suspect' | 'evidence', words: string[]): [string | null, string[]] {
  for (let n = words.length; n > 0; n--) {
    const id = resolveEntity(c, kind, words.slice(0, n).join(' '));
    if (id) return [id, words.slice(n)];
  }
  return [null, words];
}

function command(c: Case, s: GameState, line: string, now: number, io: Io): GameState {
  const [cmd = '', ...rest] = line.trim().split(/\s+/);
  switch (cmd) {
    case 'ask': {
      const [suspectId, q] = takeEntity(c, 'suspect', rest);
      if (!suspectId) throw new GameError('unknown_entity', 'who?');
      const r = ask(c, s, { suspectId, question: q.join(' ') }, now);
      io.out(renderBrief(c, r.packet));
      return r.state;
    }
    case 'examine': {
      const r = examine(c, s, { target: rest.join(' ') }, now);
      io.out(r.result.found.length ? r.result.found.map((e) => `found: ${e.name} - ${e.description}`).join('\n') : 'nothing new');
      return r.state;
    }
    case 'present': {
      const [suspectId, more] = takeEntity(c, 'suspect', rest);
      const [evidenceId] = takeEntity(c, 'evidence', more);
      if (!suspectId || !evidenceId) throw new GameError('unknown_entity', 'present <suspect> <item>');
      const r = present(c, s, { suspectId, evidenceId }, now);
      io.out(r.result.anchor ? `${r.result.outcome}: "${r.result.anchor.text}"` : r.result.outcome);
      return r.state;
    }
    case 'lab': {
      const [evidenceId] = takeEntity(c, 'evidence', rest);
      if (!evidenceId) throw new GameError('unknown_entity', 'lab <item>');
      const r = requestLab(c, s, { evidenceId }, now);
      io.out(`lab results due in ${Math.round((r.ticket.availableAt - now - s.clockOffsetMs) / 3_600_000)}h`);
      return r.state;
    }
    case 'wait': {
      const hours = Number(rest[0] ?? 0);
      const r = collectLab(c, { ...s, clockOffsetMs: s.clockOffsetMs + hours * 3_600_000 }, now);
      for (const res of r.results) io.out(`lab: ${res.factIds.map((f) => c.facts.find((x) => x.id === f)!.text).join(' ')}`);
      return r.state;
    }
    case 'hint': {
      const r = hint(c, s);
      io.out(`hint ${r.hint.level}: ${r.hint.text}`);
      return r.state;
    }
    case 'board':
      io.out(JSON.stringify(board(c, s, now), null, 2));
      return s;
    case 'accuse': {
      const [suspectId, more] = takeEntity(c, 'suspect', rest);
      if (!suspectId) throw new GameError('unknown_entity', 'accuse <suspect> <item...>');
      const evidenceIds: string[] = [];
      let left = more;
      while (left.length) {
        const [id, next] = takeEntity(c, 'evidence', left);
        if (!id) break;
        evidenceIds.push(id);
        left = next;
      }
      const r = accuse(c, s, { suspectId, evidenceIds }, now);
      io.out(`${r.verdict.outcome}: ${r.verdict.ending.text}`);
      return r.state;
    }
    default:
      io.out(HELP);
      return s;
  }
}

async function* stdinLines(): AsyncGenerator<string> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) yield line;
}

async function playtest(file: string, io: Io, script?: string[]): Promise<number> {
  const c = load(file);
  let s = newGameState(c, 'playtest', null, Date.now());
  const opening = c.anchors.find((a) => a.trigger === 'cold_open');
  io.out(opening ? opening.text : c.meta.setting);
  io.out(HELP);
  const lines = script ? (async function* () { yield* script; })() : stdinLines();
  for await (const line of lines) {
    if (line.trim() === 'quit') break;
    try {
      s = command(c, s, line, Date.now(), io);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      io.err(`${err.code}: ${err.message}${err.choices.length ? ` (try: ${err.choices.join(', ')})` : ''}`);
    }
    if (s.status !== 'active') break;
  }
  return 0;
}

export async function runCli(argv: string[], io: Io, script?: string[]): Promise<number> {
  const [cmd, file] = argv;
  if (cmd === 'lint' && file) return lint(file, io);
  if (cmd === 'playtest' && file) return playtest(file, io, script);
  io.err(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const io: Io = { out: (l) => console.log(l), err: (l) => console.error(l) };
  runCli(process.argv.slice(2), io).then((code) => process.exit(code));
}
