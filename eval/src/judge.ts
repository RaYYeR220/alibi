import { fingerprints, lookup, normalizeForMatch, type Case } from '@alibi/canon';
import type { LlmClient } from '@alibi/host';

/** Facts no one may volunteer and no evidence implies: only the ending may say them. */
export function sealedFacts(c: Case): string[] {
  const speakable = new Set(c.knowledge.filter((k) => k.tier !== 'never').map((k) => k.factId));
  const implied = new Set(c.evidence.flatMap((e) => [...e.implies, ...(e.lab?.resultFactIds ?? [])]));
  return c.facts
    .filter((f) => !speakable.has(f.id) && !implied.has(f.id) && !c.meta.startingFacts.includes(f.id))
    .map((f) => f.id);
}

/**
 * Facts that talking alone can never earn: nobody holds them as open or
 * guarded knowledge, so they take a search, a confrontation or the lab.
 */
export function evidenceLockedFacts(c: Case): string[] {
  const talkable = new Set(c.knowledge.filter((k) => k.tier === 'open' || k.tier === 'guarded').map((k) => k.factId));
  return c.facts.filter((f) => !talkable.has(f.id) && !c.meta.startingFacts.includes(f.id) && !c.evidence.some((e) => e.implies.includes(f.id))).map((f) => f.id);
}

/** Deterministic check: which facts the player had not earned does this spoken text contain? */
export function unearnedLeaks(c: Case, spoken: string, knownFactIds: string[]): string[] {
  const known = new Set(knownFactIds);
  const hay = ` ${normalizeForMatch(spoken)} `;
  const l = lookup(c);
  return c.facts
    .filter((f) => !known.has(f.id))
    .filter((f) => fingerprints(l.fact.get(f.id)!).some((fp) => hay.includes(` ${fp} `)))
    .map((f) => f.id);
}

/**
 * Evidence-locked facts given away in one spoken turn. A fingerprint the player
 * said first doesn't count (the host repeating a bluff is not a leak), and who
 * did it is graded by the model judge, not by fingerprints.
 */
export function lockedLeaks(c: Case, spoken: string, knownFactIds: string[], playerLines: string[]): string[] {
  const locked = new Set(evidenceLockedFacts(c));
  for (const f of sealedFacts(c)) locked.delete(f);
  const said = ` ${normalizeForMatch(playerLines.join(' '))} `;
  const hay = ` ${normalizeForMatch(spoken)} `;
  const known = new Set(knownFactIds);
  const l = lookup(c);
  return [...locked].filter(
    (id) => !known.has(id) && fingerprints(l.fact.get(id)!).some((fp) => hay.includes(` ${fp} `) && !said.includes(` ${fp} `)),
  );
}

/** Wilson score interval for a binomial proportion (95%). */
export function wilson(successes: number, n: number, z = 1.96): { rate: number; low: number; high: number } {
  if (n === 0) return { rate: 0, low: 0, high: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface CulpritVerdict {
  spoiler: boolean;
  quote: string;
}

/**
 * Model judge for the comparison metric: does one spoken response give away
 * who did it? Suspicion and clues are fine; naming or confessing is not.
 */
export async function culpritJudge(llm: LlmClient, model: string, c: Case, spoken: string): Promise<CulpritVerdict> {
  const culprit = lookup(c).suspect.get(c.solution.culprit)!.name;
  const { message } = await llm.chat({
    model,
    temperature: 0,
    maxTokens: 120,
    messages: [
      {
        role: 'system',
        content:
          'You grade one line from a murder-mystery game for spoilers. Reply with JSON only: {"spoiler": true|false, "quote": "<the giveaway words or empty>"}.',
      },
      {
        role: 'user',
        content: `Secret solution: ${culprit} is guilty (${c.facts.find((f) => f.id === c.solution.motiveFact)?.text}).
A spoiler is a line that states or confesses that ${culprit} did it, names ${culprit} as the culprit, or reveals the solution outright. Suspicion, a clue, an alibi or a lie is NOT a spoiler.

Line to grade:
"""${spoken}"""`,
      },
    ],
  });
  try {
    const json = JSON.parse((message.content ?? '').replace(/^```(json)?|```$/g, '').trim()) as CulpritVerdict;
    return { spoiler: Boolean(json.spoiler), quote: String(json.quote ?? '') };
  } catch {
    return { spoiler: /"spoiler"\s*:\s*true/.test(message.content ?? ''), quote: '' };
  }
}

/** One record per run id, the last one written: a resumed or repeated range never counts twice. */
export function latestRuns<T extends { run: number }>(rows: T[]): T[] {
  const byRun = new Map<number, T>();
  for (const r of rows) byRun.set(r.run, r);
  return [...byRun.values()].sort((a, b) => a.run - b.run);
}
