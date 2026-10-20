import { CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import type { LabScheduler } from '../deps.js';

export interface SchedulerConfig {
  groupName: string;
  /** The lab-ready Lambda. */
  targetArn: string;
  /** Role EventBridge Scheduler assumes to invoke it. */
  roleArn: string;
  client?: Pick<SchedulerClient, 'send'> | { send: (cmd: CreateScheduleCommand) => Promise<unknown> };
}

const atExpression = (ms: number) => `at(${new Date(ms).toISOString().slice(0, 19)})`;

/** One-time EventBridge schedules: at the moment a lab result is due, notify the household. */
export function createEventBridgeScheduler(cfg: SchedulerConfig): LabScheduler {
  const client = cfg.client ?? new SchedulerClient({});
  return {
    async schedule(householdId, gameId, evidenceId, at) {
      const name = `lab-${gameId}-${evidenceId}`.replace(/[^0-9a-zA-Z_.-]/g, '-').slice(0, 64);
      try {
        await client.send(
          new CreateScheduleCommand({
          Name: name,
          GroupName: cfg.groupName,
          ScheduleExpression: atExpression(Math.max(at, Date.now() + 60_000)),
          ScheduleExpressionTimezone: 'UTC',
          FlexibleTimeWindow: { Mode: 'OFF' },
          ActionAfterCompletion: 'DELETE',
          Target: {
            Arn: cfg.targetArn,
            RoleArn: cfg.roleArn,
            Input: JSON.stringify({ householdId, gameId, evidenceId }),
          },
        }) as never,
        );
      } catch (err) {
        // The name is per game and item, so an existing schedule is this same lab run.
        if ((err as { name?: string }).name !== 'ConflictException') throw err;
      }
    },
  };
}
