import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCase } from '@alibi/canon';
import type { LlmClient, LlmRequest } from '@alibi/host';
import { alibiArm } from '../src/arms.js';

const paid = parseCase(JSON.parse(readFileSync(join(__dirname, '..', '..', 'cases', 'lighthouse-storm', 'case.json'), 'utf8')));

/** Opens the case with one tool call, then just acknowledges. */
function scripted(caseId: string): LlmClient {
  let calls = 0;
  return {
    async chat(_req: LlmRequest) {
      calls += 1;
      const message =
        calls === 1
          ? { role: 'assistant' as const, content: null, tool_calls: [{ id: 't1', type: 'function' as const, function: { name: 'start_case', arguments: JSON.stringify({ case_id: caseId }) } }] }
          : { role: 'assistant' as const, content: 'Go on.' };
      return { message, usage: { inTok: 0, outTok: 0 } };
    },
  };
}

describe('alibi arm', () => {
  it('plays paid cases, not the store page', async () => {
    expect(paid.meta.priceCents).toBeGreaterThan(0);
    const arm = await alibiArm(paid, scripted(paid.meta.id), 'scripted');
    const { known } = await arm.turn('Who are you?');
    expect(known).toEqual(expect.arrayContaining(paid.meta.startingFacts));
  });

  it('refuses to score a session that never opened the case', async () => {
    const silent: LlmClient = { chat: async () => ({ message: { role: 'assistant', content: 'Hello.' }, usage: { inTok: 0, outTok: 0 } }) };
    await expect(alibiArm(paid, silent, 'scripted')).rejects.toThrow(/did not open/);
  });
});
