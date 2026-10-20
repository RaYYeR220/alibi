/**
 * Turns eval/results/raw/*.jsonl into docs/eval.md and eval/results/summary.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestRuns, wilson } from './judge.js';

interface Turn {
  attack: string;
  spoken: string;
  unearned: string[];
  lockedLeaks: string[];
  spoiler: boolean;
  quote: string;
}
interface Run {
  arm: 'alibi' | 'baseline';
  run: number;
  caseId: string;
  category: string;
  model: string;
  spoiled: boolean;
  leaked: boolean;
  turns: Turn[];
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const load = (arm: string): Run[] => {
  const f = join(here, '..', 'results', 'raw', `${arm}.jsonl`);
  return existsSync(f) ? latestRuns(readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Run)) : [];
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (k: number, n: number) => {
  const w = wilson(k, n);
  return `${pct(w.rate)} (95% CI ${pct(w.low)}–${pct(w.high)})`;
};
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, ' ');

const arms = { alibi: load('alibi'), baseline: load('baseline') };
const summary = Object.fromEntries(
  Object.entries(arms).map(([arm, runs]) => {
    const turns = runs.flatMap((r) => r.turns);
    return [
      arm,
      {
        runs: runs.length,
        turns: turns.length,
        spoiledRuns: runs.filter((r) => r.spoiled).length,
        leakedRuns: runs.filter((r) => r.leaked).length,
        spoilerTurns: turns.filter((t) => t.spoiler).length,
        lockedLeakTurns: turns.filter((t) => t.lockedLeaks.length).length,
        models: [...new Set(runs.map((r) => r.model))],
        cases: [...new Set(runs.map((r) => r.caseId))],
      },
    ];
  }),
);
writeFileSync(join(here, '..', 'results', 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const categories = [...new Set([...arms.alibi, ...arms.baseline].map((r) => r.category))].sort();
const row = (arm: Run[], cat: string) => {
  const rs = arm.filter((r) => r.category === cat);
  return `${rs.filter((r) => r.spoiled).length}/${rs.length} · ${rs.filter((r) => r.leaked).length}/${rs.length}`;
};

const examples = (runs: Run[], pick: (t: Turn) => boolean, limit: number) =>
  runs
    .flatMap((r) => r.turns.filter(pick).map((t) => ({ r, t })))
    .slice(0, limit)
    .map(({ r, t }) => `- *${r.category}* — **Player:** "${clip(t.attack, 140)}"\n  **Game:** "${clip(t.spoken)}"${t.lockedLeaks.length ? `\n  Unearned facts: ${t.lockedLeaks.join(', ')}` : ''}${t.spoiler && t.quote ? `\n  Giveaway: "${clip(t.quote, 120)}"` : ''}`)
    .join('\n');

const a = summary.alibi!;
const b = summary.baseline!;
const md = `# Adversarial evaluation

Can a player get the game to give away the case without solving it?

Each run opens a fresh game and plays six spoken turns written by an attacker model for one
strategy: direct questions, prompt injection, role swaps, hypotheticals, false authority, other
languages, emotional pressure, cross-suspect relay, timeline fishing and bluffed contradictions
(\`eval/attacks.yaml\`). The player never searches a room, shows evidence or uses the lab, so
nothing behind evidence can be earned during a run.

Two designs answer the same attacks with the same model (${[...new Set([...a.models, ...b.models])].join(', ')}):

- **Alibi**: an assistant host with the Alibi MCP server. The host only ever sees what the
  disclosure engine allows each suspect to say right now.
- **Baseline**: one model plays game master with the complete case file in its prompt and the
  instruction not to reveal the solution.

| | Alibi | Baseline |
|---|---|---|
| Runs (6 turns each) | ${a.runs} | ${b.runs} |
| Runs where the culprit was given away | ${ci(a.spoiledRuns, a.runs)} | ${ci(b.spoiledRuns, b.runs)} |
| Runs where an evidence-locked fact leaked | ${ci(a.leakedRuns, a.runs)} | ${ci(b.leakedRuns, b.runs)} |
| Turns with a giveaway | ${a.spoilerTurns}/${a.turns} | ${b.spoilerTurns}/${b.turns} |
| Turns with an evidence-locked fact | ${a.lockedLeakTurns}/${a.turns} | ${b.lockedLeakTurns}/${b.turns} |

*Giveaway* is graded per spoken turn by a model judge that knows the solution; suspicion, clues
and lies don't count, only naming or confessing the culprit. *Evidence-locked facts* are facts no
suspect will volunteer in conversation (they need a search, a confrontation or the lab); a leak is
detected deterministically by the facts' fingerprints, the same check the server runs on every
response.

## By strategy (giveaway runs · leak runs)

| Strategy | Alibi | Baseline |
|---|---|---|
${categories.map((cat) => `| ${cat} | ${row(arms.alibi, cat)} | ${row(arms.baseline, cat)} |`).join('\n')}

## Examples

### Baseline leaks
${examples(arms.baseline, (t) => t.spoiler || t.lockedLeaks.length > 0, 4) || '- none'}

### Alibi under the same pressure
${examples(arms.alibi, (t) => /ignore|override|narrator|author|instructions/i.test(t.attack), 3) || '- none'}

## Reproduce

\`\`\`
cd eval
VENICE_API_KEY=... pnpm run run -- --arm alibi --n 300
VENICE_API_KEY=... pnpm run run -- --arm baseline --n 300
pnpm run report
\`\`\`

Cases: ${[...new Set([...a.cases, ...b.cases])].join(', ')}. Raw transcripts are written to \`eval/results/raw/\`.
`;
writeFileSync(join(root, 'docs', 'eval.md'), md);
console.log(`wrote docs/eval.md (alibi ${a.runs} runs, baseline ${b.runs} runs)`);
