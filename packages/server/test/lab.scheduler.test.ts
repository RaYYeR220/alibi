import { describe, expect, it } from 'vitest';
import type { CaseIntroView } from '@alibi/canon';
import { createEventBridgeScheduler } from '../src/lab/scheduler.js';
import { handleLabReady } from '../src/lambda-lab.js';
import { connect, testDeps, userAuth, view } from './harness.js';

describe('lab scheduling', () => {
  it('creates a one-time schedule that deletes itself and targets the lab lambda', async () => {
    const sent: any[] = [];
    const scheduler = createEventBridgeScheduler({
      groupName: 'alibi-labs',
      targetArn: 'arn:aws:lambda:us-east-1:1:function:alibi-lab',
      roleArn: 'arn:aws:iam::1:role/scheduler',
      client: { send: async (cmd: any) => void sent.push(cmd.input) },
    });
    await scheduler.schedule('alice', 'g_abc', 'e_desk_key', Date.UTC(2026, 9, 21, 8, 0, 0));
    expect(sent[0]).toMatchObject({
      GroupName: 'alibi-labs',
      ScheduleExpression: 'at(2026-10-21T08:00:00)',
      ScheduleExpressionTimezone: 'UTC',
      ActionAfterCompletion: 'DELETE',
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: { Arn: 'arn:aws:lambda:us-east-1:1:function:alibi-lab', RoleArn: 'arn:aws:iam::1:role/scheduler' },
    });
    expect(JSON.parse(sent[0].Target.Input)).toEqual({ householdId: 'alice', gameId: 'g_abc', evidenceId: 'e_desk_key' });
    expect(sent[0].Name).toMatch(/^lab-g_abc-e_desk_key/);
  });

  it('the lab-ready handler drops a notification in the household inbox', async () => {
    const deps = testDeps();
    const client = await connect(deps, userAuth('alice'));
    const { gameId } = view<CaseIntroView>(await client.callTool({ name: 'start_case', arguments: { case_id: 'tiny-brooch' } }));
    await handleLabReady(deps, { householdId: 'alice', gameId, evidenceId: 'e_desk_key' });
    const inbox = await deps.inbox.list('alice');
    expect(inbox).toEqual([expect.objectContaining({ kind: 'lab_ready', gameId, text: expect.stringContaining('brass desk key') })]);
  });
});
