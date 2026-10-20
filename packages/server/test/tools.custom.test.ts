import { describe, expect, it, vi } from 'vitest';
import type { ProgressView, PurchaseView } from '@alibi/canon';
import { createStepFunctionsDispatcher } from '../src/custom/dispatch.js';
import { connect, testDeps, text, userAuth, view } from './harness.js';

const args = { names: ['Ada', 'Tunde', 'Chioma'], occasion: "Grandma Ada's 80th birthday", tone: 'cozy', rating: 'family' };

describe('custom cases', () => {
  it('without credit returns custom-case purchase offer', async () => {
    const deps = testDeps();
    const client = await connect(deps, userAuth('okafor'));
    const r = await client.callTool({ name: 'create_custom_case', arguments: args });
    const v = view<PurchaseView>(r);
    expect(v).toMatchObject({ kind: 'purchase', sku: 'custom-case', priceCents: 1499 });
    expect(text(r)).toMatch(/\$14\.99/);
  });

  it('blocked name is refused politely', async () => {
    const deps = testDeps();
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    const client = await connect(deps, userAuth('okafor'));
    const r = await client.callTool({ name: 'create_custom_case', arguments: { ...args, names: ['Ada', 'shithead'] } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/can't use/i);
    expect(await deps.entitlements.has('okafor', 'custom-case')).toBe(true);
  });

  it('quota exceeded returns try-tomorrow text', async () => {
    const deps = testDeps({ demoMode: true });
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    await deps.jobs.incrementToday('custom:okafor');
    const client = await connect(deps, userAuth('okafor'));
    const r = await client.callTool({ name: 'create_custom_case', arguments: args });
    expect(text(r)).toMatch(/tomorrow/i);
    expect(await deps.entitlements.has('okafor', 'custom-case')).toBe(true);
  });

  it('with credit creates queued job and consumes credit', async () => {
    const enqueue = vi.fn(async () => {});
    const deps = testDeps({ dispatcher: { enqueueCasegen: enqueue } });
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    const client = await connect(deps, userAuth('okafor'));
    const r = await client.callTool({ name: 'create_custom_case', arguments: args });
    const v = view<ProgressView>(r);
    expect(v.jobs).toEqual([expect.objectContaining({ status: 'queued' })]);
    const jobId = v.jobs[0]!.jobId;
    expect(enqueue).toHaveBeenCalledWith(jobId);
    expect(await deps.entitlements.has('okafor', 'custom-case')).toBe(false);
    expect(await deps.jobs.get(jobId)).toMatchObject({ householdId: 'okafor', input: expect.objectContaining({ names: args.names, tone: 'cozy' }) });

    const status = await client.callTool({ name: 'check_custom_case', arguments: { job_id: jobId } });
    expect(text(status)).toMatch(/writing|queued/i);
  });

  it('a case that cannot be started gives the credit back', async () => {
    const deps = testDeps({ demoMode: true, dispatcher: { enqueueCasegen: async () => { throw new Error('throttled'); } } });
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    const client = await connect(deps, userAuth('okafor'));
    const r = await client.callTool({ name: 'create_custom_case', arguments: args });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/couldn't start/i);
    expect(await deps.entitlements.has('okafor', 'custom-case')).toBe(true);
    const [job] = await deps.jobs.listByHousehold('okafor');
    expect(job).toMatchObject({ status: 'failed' });
    expect(await deps.jobs.countToday('custom:okafor')).toBe(0);
  });

  it('a case that started despite a dispatch error keeps the credit spent', async () => {
    const deps = testDeps();
    deps.dispatcher = {
      enqueueCasegen: async (jobId) => {
        await deps.jobs.update(jobId, { status: 'running', stage: 'moderate' });
        throw new Error('socket hang up');
      },
    };
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    const client = await connect(deps, userAuth('okafor'));
    const r = await client.callTool({ name: 'create_custom_case', arguments: args });
    expect(text(r)).not.toMatch(/couldn't start/i);
    expect(await deps.entitlements.has('okafor', 'custom-case')).toBe(false);
    const [job] = await deps.jobs.listByHousehold('okafor');
    expect(job).toMatchObject({ status: 'running' });
  });

  it('missing names asks for them', async () => {
    const deps = testDeps();
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    const client = await connect(deps, userAuth('okafor'));
    const r = await client.callTool({ name: 'create_custom_case', arguments: { names: [] } });
    expect(text(r)).toMatch(/who should be in it/i);
  });

  it('another household cannot read a job', async () => {
    const deps = testDeps();
    await deps.entitlements.grant('okafor', 'custom-case', 'ord-1');
    const owner = await connect(deps, userAuth('okafor'));
    const jobId = view<ProgressView>(await owner.callTool({ name: 'create_custom_case', arguments: args })).jobs[0]!.jobId;
    const other = await connect(deps, userAuth('mallory'));
    const r = await other.callTool({ name: 'check_custom_case', arguments: { job_id: jobId } });
    expect(text(r)).toMatch(/can't find/i);
  });

  it('the Step Functions dispatcher starts one execution per job', async () => {
    const sent: any[] = [];
    const d = createStepFunctionsDispatcher({ stateMachineArn: 'arn:sm', client: { send: async (c: any) => void sent.push(c.input) } });
    await d.enqueueCasegen('job_123');
    expect(sent).toEqual([{ stateMachineArn: 'arn:sm', name: 'job_123', input: JSON.stringify({ jobId: 'job_123' }) }]);
  });
});
