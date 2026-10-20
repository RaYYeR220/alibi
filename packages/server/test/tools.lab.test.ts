import { describe, expect, it, vi } from 'vitest';
import type { CaseIntroView, LabView, ProgressView } from '@alibi/canon';
import { connect, serviceAuth, testDeps, text, userAuth, view } from './harness.js';

const HOUR = 3_600_000;

async function gameWithKey(deps: ReturnType<typeof testDeps>, sub = 'alice') {
  const client = await connect(deps, userAuth(sub));
  const { gameId } = view<CaseIntroView>(await client.callTool({ name: 'start_case', arguments: { case_id: 'tiny-brooch' } }));
  await client.callTool({ name: 'examine', arguments: { game_id: gameId, target: 'dining room' } });
  return { client, gameId };
}

describe('lab, progress and demo clock', () => {
  it('lab requested now is pending, ready after set_demo_clock 14h', async () => {
    const schedule = vi.fn(async () => {});
    const deps = testDeps({ demoMode: true, scheduler: { schedule } });
    const { client, gameId } = await gameWithKey(deps);

    const req = await client.callTool({ name: 'request_lab_test', arguments: { game_id: gameId, evidence: 'brass key' } });
    const pending = view<LabView>(req);
    expect(pending.pending.map((p) => p.evidenceId)).toEqual(['e_desk_key']);
    expect(text(req)).toMatch(/lab/i);
    expect(schedule).toHaveBeenCalledWith('alice', gameId, 'e_desk_key', deps.clock() + 14 * HOUR);

    const early = await client.callTool({ name: 'check_lab_results', arguments: { game_id: gameId } });
    expect(view<LabView>(early).results).toEqual([]);

    await client.callTool({ name: 'set_demo_clock', arguments: { game_id: gameId, advance_hours: 14 } });
    const ready = await client.callTool({ name: 'check_lab_results', arguments: { game_id: gameId } });
    expect(view<LabView>(ready).results[0]).toMatchObject({ evidenceId: 'e_desk_key', findings: [expect.stringMatching(/lily perfume/)] });
  });

  it('sending the same item twice books the lab once', async () => {
    const schedule = vi.fn(async () => {});
    const deps = testDeps({ scheduler: { schedule } });
    const { client, gameId } = await gameWithKey(deps);
    await client.callTool({ name: 'request_lab_test', arguments: { game_id: gameId, evidence: 'brass key' } });
    const again = await client.callTool({ name: 'request_lab_test', arguments: { game_id: gameId, evidence: 'brass key' } });
    expect(again.isError).toBeFalsy();
    expect(text(again)).toMatch(/already/i);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('sending an item not found yet gives nothing away', async () => {
    const deps = testDeps();
    const client = await connect(deps, userAuth('alice'));
    const { gameId } = view<CaseIntroView>(await client.callTool({ name: 'start_case', arguments: { case_id: 'tiny-brooch' } }));
    const r = await client.callTool({ name: 'request_lab_test', arguments: { game_id: gameId, evidence: 'brass key' } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/haven't found/i);
    expect(JSON.stringify(r)).not.toMatch(/e_desk_key|desk key/i);
  });

  it('my_progress lists in-progress game and ready lab', async () => {
    const deps = testDeps({ demoMode: true });
    const { client, gameId } = await gameWithKey(deps);
    await client.callTool({ name: 'request_lab_test', arguments: { game_id: gameId, evidence: 'desk key' } });
    await client.callTool({ name: 'set_demo_clock', arguments: { game_id: gameId, advance_hours: 15 } });
    await deps.inbox.add('alice', { id: 'i1', kind: 'lab_ready', text: 'The lab results for the brass desk key are in.', at: deps.clock(), gameId });

    const v = view<ProgressView>(await client.callTool({ name: 'my_progress', arguments: {} }));
    expect(v.games).toEqual([expect.objectContaining({ gameId, caseId: 'tiny-brooch', status: 'active' })]);
    expect(v.labsReady).toEqual([expect.objectContaining({ gameId, evidenceId: 'e_desk_key' })]);
    expect(v.inbox.map((i) => i.kind)).toEqual(['lab_ready']);
  });

  it('set_demo_clock is absent from tools/list when demoMode false', async () => {
    const client = await connect(testDeps({ demoMode: false }), userAuth('alice'));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('set_demo_clock');
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['request_lab_test', 'check_lab_results', 'my_progress']));
  });

  it('lab tools ask a guest to link their account', async () => {
    const client = await connect(testDeps(), serviceAuth);
    const r = await client.callTool({ name: 'my_progress', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/link/i);
  });

  it('the household inbox is readable as a resource', async () => {
    const deps = testDeps();
    await deps.inbox.add('alice', { id: 'i1', kind: 'custom_ready', text: 'Your case is ready.', at: 1 });
    const client = await connect(deps, userAuth('alice'));
    const res = await client.readResource({ uri: 'alibi://household/inbox' });
    const items = JSON.parse((res.contents[0] as { text: string }).text);
    expect(items).toEqual([expect.objectContaining({ id: 'i1', kind: 'custom_ready' })]);
  });
});
