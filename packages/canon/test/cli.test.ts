import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

const tiny = fileURLToPath(new URL('./fixtures/tiny-case.json', import.meta.url));

function capture() {
  const lines: string[] = [];
  return { lines, io: { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) } };
}

describe('alibi-canon cli', () => {
  it('lint reports 0 issues for a clean case and exits 0', async () => {
    const { lines, io } = capture();
    expect(await runCli(['lint', tiny], io)).toBe(0);
    expect(lines.join('\n')).toMatch(/0 issues/);
  });

  it('playtest runs a scripted session to a verdict', async () => {
    const { lines, io } = capture();
    const script = ['examine study', 'present clara handkerchief', 'accuse clara handkerchief', 'quit'];
    expect(await runCli(['playtest', tiny], io, script)).toBe(0);
    expect(lines.join('\n')).toMatch(/correct/);
  });

  it('unknown command prints usage and exits 2', async () => {
    const { lines, io } = capture();
    expect(await runCli(['frobnicate'], io)).toBe(2);
    expect(lines.join('\n')).toMatch(/usage/i);
  });
});
