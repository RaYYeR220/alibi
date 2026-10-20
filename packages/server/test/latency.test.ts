import { describe, expect, it } from 'vitest';
import { connect, testDeps, view } from './harness.js';

describe('latency budget', () => {
  it('200 sequential tool calls cost under 10 ms of CPU each in-process', async () => {
    const client = await connect(testDeps());
    const { gameId } = view(await client.callTool({ name: 'start_case', arguments: { case_id: 'tiny-brooch' } }));
    const questions = ['Where were you at nine?', 'Tell me about the brooch', 'Who has the desk key?', 'Any money troubles?', 'Who else was here?'];
    const suspects = ['harold', 'clara', 'perkins'];
    const call = (i: number) =>
      client.callTool({
        name: i % 10 === 9 ? 'get_case_board' : 'ask_suspect',
        arguments: { game_id: gameId, suspect: suspects[i % 3], question: questions[i % questions.length] },
      });
    for (let i = 0; i < 30; i++) await call(i); // JIT warm-up is not the steady state we budget for
    const timings: number[] = [];
    const cpu0 = process.cpuUsage();
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      await call(i);
      timings.push(performance.now() - t0);
    }
    timings.sort((a, b) => a - b);
    const cpu = process.cpuUsage(cpu0);
    const cpuPerCall = (cpu.user + cpu.system) / 1000 / timings.length;
    const p50 = timings[100]!;
    const p95 = timings[Math.floor(timings.length * 0.95)]!;
    // Wall-clock percentiles on a shared dev machine are scheduler noise (client and server share
    // this process); CPU per call is the stable signal. The real p95 gate is the deployed smoke test.
    console.log(`in-process cpu/call=${cpuPerCall.toFixed(2)}ms wall p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
    expect(cpuPerCall).toBeLessThan(10);
  }, 60_000);
});
