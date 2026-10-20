import type { Counters } from './counters.js';

/**
 * Venice list prices in USD per million tokens. Prompt tokens above the
 * extended-context threshold are billed at the higher rate; cached reads are
 * billed as full input to keep the estimate on the safe side.
 */
export const PRICES: Record<string, { input: number; output: number; extended?: { above: number; input: number; output: number } }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, extended: { above: 100_000, input: 0.5, output: 2.5 } },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

export const MODELS = Object.keys(PRICES);

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** Cost of one completion in micro-dollars (integer, so counters stay exact). */
export function costMicros(model: string, usage: Usage | undefined): number {
  const price = PRICES[model];
  if (!price) throw new Error(`no price for ${model}`);
  const inTok = Math.max(0, usage?.prompt_tokens ?? 0);
  const outTok = Math.max(0, usage?.completion_tokens ?? 0);
  const rate = price.extended && inTok > price.extended.above ? price.extended : price;
  return Math.ceil(inTok * rate.input + outTok * rate.output);
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

const DAY_MS = 86_400_000;
const SPEND_KEY = 'venice';

/** Today's Venice spend (UTC day), shared by every instance. */
export function spendLedger(counters: Counters, clock: () => number) {
  const pk = () => `QUOTA#${dayKey(clock())}`;
  return {
    async spentMicros(): Promise<number> {
      return counters.get(pk(), SPEND_KEY);
    },
    async record(micros: number): Promise<number> {
      return counters.add(pk(), SPEND_KEY, micros, clock() + 3 * DAY_MS);
    },
  };
}
