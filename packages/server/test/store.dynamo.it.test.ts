import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import { describe, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import { createDynamoStores } from '../src/store/dynamo.js';
import { storeContract, tinyCase } from './store.contract.js';

if (process.env.ALIBI_IT === '1') {
  const client = new DynamoDBClient({ region: 'us-east-1', credentials: fromIni({ profile: process.env.AWS_PROFILE ?? 'countercharge' }) });
  storeContract('dynamo', async () => {
    const clock = { now: Date.now() };
    return { stores: createDynamoStores({ table: process.env.ALIBI_TABLE ?? 'alibi', bundled: [tinyCase], clock: () => clock.now, client }), clock };
  });
} else {
  describe('dynamo stores', () => {
    it.skip('run with ALIBI_IT=1 against the deployed table', () => {});
  });
}
