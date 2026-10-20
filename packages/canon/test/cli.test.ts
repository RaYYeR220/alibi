import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { rawTiny } from './helpers.js';

const tiny = fileURLToPath(new URL('./fixtures/tiny-case.json', import.meta.url));

function capture() {
  const lines: string[] = [];
  return { lines, io: { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) } };
}

function writeCase(mutate: (raw: any) => void): string {
  const raw = rawTiny();
  mutate(raw);
  const file = join(mkdtempSync(join(tmpdir(), 'alibi-cli-')), 'case.json');
  writeFileSync(file, JSON.stringify(raw));
  return file;
}

describe('alibi-canon redteam', () => {
  it('reports no violations on a sound case and exits 0', async () => {
    const { lines, io } = capture();
    expect(await runCli(['redteam', tiny, '--runs', '60', '--json'], io)).toBe(0);
    const report = JSON.parse(lines.join('\n'));
    expect(report).toMatchObject({ caseId: 'tiny-brooch', runs: 60, violationCount: 0, violations: [] });
    expect(report.steps).toBeGreaterThan(60);
  });

  it('catches a lie that leaks a fact the player has not earned and exits 1', async () => {
    const leaky = writeCase((raw) => {
      raw.lies[0].claim = 'I was nowhere near it. Perkins was polishing silver in the pantry, ask him.';
    });
    const { lines, io } = capture();
    expect(await runCli(['redteam', leaky, '--runs', '300', '--json'], io)).toBe(1);
    const report = JSON.parse(lines.join('\n'));
    expect(report.violationCount).toBeGreaterThan(0);
    expect(report.violations[0]).toMatchObject({ kind: 'guard', leakedFactIds: ['f_perkins_pantry'] });
    expect(report.violations[0].action).toBeDefined();
  });

  it('prints a readable summary without --json', async () => {
    const { lines, io } = capture();
    expect(await runCli(['redteam', tiny, '--runs', '20'], io)).toBe(0);
    expect(lines.join('\n')).toMatch(/20 runs, \d+ steps, 0 violations/);
  });

  it('is reproducible for a fixed seed', async () => {
    const a = capture();
    const b = capture();
    await runCli(['redteam', tiny, '--runs', '30', '--seed', '7', '--json'], a.io);
    await runCli(['redteam', tiny, '--runs', '30', '--seed', '7', '--json'], b.io);
    expect(JSON.parse(a.lines.join('\n')).steps).toBe(JSON.parse(b.lines.join('\n')).steps);
  });
});

describe('alibi-canon on a malformed case', () => {
  it('lint lists format issues instead of crashing and exits 1', async () => {
    const broken = writeCase((raw) => {
      raw.knowledge[2].factId = 'f_nope';
    });
    const { lines, io } = capture();
    expect(await runCli(['lint', broken, '--json'], io)).toBe(1);
    const report = JSON.parse(lines.join('\n'));
    expect(report.issues).toContainEqual({ code: 'format', detail: 'knowledge[2].factId: unknown fact "f_nope"' });
  });

  it('lint --json reports a clean case as an empty list', async () => {
    const { lines, io } = capture();
    expect(await runCli(['lint', tiny, '--json'], io)).toBe(0);
    expect(JSON.parse(lines.join('\n'))).toEqual({ issues: [] });
  });
});

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
