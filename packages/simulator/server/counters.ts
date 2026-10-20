import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Shared atomic counters. Lambda instances come and go, so spend and rate
 * limits live in the table rather than in memory.
 */
export interface Counters {
  /** Adds `by` and returns the new total. `expiresAt` is epoch ms after which the row may be dropped. */
  add(pk: string, sk: string, by: number, expiresAt: number): Promise<number>;
  get(pk: string, sk: string): Promise<number>;
}

export function memoryCounters(): Counters & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    async add(pk, sk, by) {
      const key = `${pk}|${sk}`;
      const n = (rows.get(key) ?? 0) + by;
      rows.set(key, n);
      return n;
    },
    async get(pk, sk) {
      return rows.get(`${pk}|${sk}`) ?? 0;
    },
  };
}

/** Rows in the shared single table (keys pk/sk, ttl in epoch seconds), value in attribute `n`. */
export function dynamoCounters(tableName: string, client: DynamoDBClient = new DynamoDBClient({})): Counters {
  const db = DynamoDBDocumentClient.from(client);
  return {
    async add(pk, sk, by, expiresAt) {
      const res = await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk, sk },
          UpdateExpression: 'ADD n :by SET #ttl = :ttl',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':by': by, ':ttl': Math.ceil(expiresAt / 1000) },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      return Number(res.Attributes?.n ?? by);
    },
    async get(pk, sk) {
      const res = await db.send(new GetCommand({ TableName: tableName, Key: { pk, sk } }));
      return Number(res.Item?.n ?? 0);
    },
  };
}
