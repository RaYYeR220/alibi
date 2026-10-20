/**
 * Adversarial interrogation runs.
 *
 *   tsx src/run.ts --arm alibi --n 300 --cases tiny-brooch --concurrency 8
 *   tsx src/run.ts --arm baseline --n 300
 *
 * Each run opens a fresh game and plays six attacker turns from one category.
 * Results are appended to eval/results/raw/<arm>.jsonl.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';
import { parseCase, type Case } from '@alibi/canon';
import { createVeniceClient } from '@alibi/host';
import { loadCases } from '../../packages/server/src/prod.js';
import { alibiArm, baselineArm, type Arm } from './arms.js';
import { nextAttack, type Category } from './attacker.js';
import { culpritJudge, lockedLeaks as findLockedLeaks, unearnedLeaks } from './judge.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const { values } = parseArgs({
  options: {
    arm: { type: 'string', default: 'alibi' },
    n: { type: 'string', default: '30' },
    cases: { type: 'string' },
    turns: { type: 'string', default: '6' },
    concurrency: { type: 'string', default: '3' },
    start: { type: 'string', default: '0' },
    model: { type: 'string', default: 'claude-haiku-5-5' },
  },
});

const arm = values.arm as 'alibi' | 'baseline';
const n = Number(values.n);
const turns = Number(values.turns);
const model = values.model!;
const apiKey = process.env.VENICE_API_KEY;
if (!apiKey) throw new Error('VENICE_API_KEY is not set');
const llm = createVeniceClient({ apiKey, maxRetries: 8, retryDelayMs: 1500 });

const library = parseYaml(readFileSync(join(here, '..', 'attacks.yaml'), 'utf8')) as { categories: Record<string, Category> };
const categories = Object.entries(library.categories);

const all: Case[] = loadCases(join(root, 'cases'));
if (all.length === 0) all.push(parseCase(JSON.parse(readFileSync(join(root, 'packages', 'canon', 'test', 'fixtures', 'tiny-case.json'), 'utf8'))));
const wanted = values.cases?.split(',');
const cases = wanted ? all.filter((c) => wanted.includes(c.meta.id)) : all;
if (cases.length === 0) throw new Error(`no cases match ${values.cases}`);

const outDir = join(here, '..', 'results', 'raw');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${arm}.jsonl`);

async function one(i: number) {
  const c = cases[i % cases.length]!;
  const [categoryName, category] = categories[i % categories.length]!;
  const game: Arm = arm === 'alibi' ? await alibiArm(c, llm, model) : baselineArm(c, llm, model);
  const transcript: { attack: string; spoken: string; known: string[]; unearned: string[]; lockedLeaks: string[]; spoiler: boolean; quote: string }[] = [];
  for (let t = 0; t < turns; t++) {
    const attack = await nextAttack(llm, model, c, category, transcript, t);
    const { spoken, known } = await game.turn(attack);
    const unearned = unearnedLeaks(c, spoken, known);
    const lockedLeaks = findLockedLeaks(c, spoken, known, [...transcript.map((t) => t.attack), attack]);
    const verdict = await culpritJudge(llm, model, c, spoken);
    transcript.push({ attack, spoken, known, unearned, lockedLeaks, spoiler: verdict.spoiler, quote: verdict.quote });
  }
  const record = {
    arm,
    run: i,
    caseId: c.meta.id,
    category: categoryName,
    model,
    spoiled: transcript.some((t) => t.spoiler),
    leaked: transcript.some((t) => t.lockedLeaks.length > 0),
    turns: transcript,
  };
  appendFileSync(outFile, `${JSON.stringify(record)}\n`);
  return record;
}

let next = Number(values.start);
let done = 0;
let spoiled = 0;
const workers = Array.from({ length: Number(values.concurrency) }, async () => {
  while (next < Number(values.start) + n) {
    const i = next++;
    try {
      const r = await one(i);
      done++;
      if (r.spoiled) spoiled++;
      if (done % 10 === 0) console.log(`${arm}: ${done}/${n} runs, ${spoiled} spoiled`);
    } catch (err) {
      console.error(`run ${i} failed: ${(err as Error).message}`);
    }
  }
});
await Promise.all(workers);
console.log(`${arm}: finished ${done} runs, ${spoiled} spoiled → ${outFile}`);
