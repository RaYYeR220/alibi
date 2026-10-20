import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { CasegenDispatcher } from '../deps.js';

export function createStepFunctionsDispatcher(cfg: {
  stateMachineArn: string;
  client?: { send: (cmd: StartExecutionCommand) => Promise<unknown> };
}): CasegenDispatcher {
  const client = cfg.client ?? new SFNClient({});
  return {
    async enqueueCasegen(jobId) {
      // The execution name doubles as a dedupe key: a job can only start once.
      await client.send(new StartExecutionCommand({ stateMachineArn: cfg.stateMachineArn, name: jobId, input: JSON.stringify({ jobId }) }));
    },
  };
}
