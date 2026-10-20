import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { parseCase, type Case, type GameState } from '@alibi/canon';
import {
  ConflictError,
  dayKey,
  GUEST_TTL_MS,
  isExpiredGuest,
  metaOf,
  type CheckoutSession,
  type IdempotencyRecord,
  type InboxItem,
  type Job,
  type Stores,
} from './types.js';

/**
 * Single-table layout (table "alibi", keys pk/sk):
 *   GAME#<id>/STATE          game state (guest games carry a ttl)
 *   HH#<hh>/GAME#<id>        household → game pointer
 *   HH#<hh>/ENT#<sku>        entitlement credits
 *   ORDER#<id>/GRANT         marks an order as already credited
 *   CHK#<id>/SESSION         UCP checkout session
 *   IDEM#<owner>#<key>/IDEM  idempotent response replay, per caller
 *   JOB#<id>/JOB             custom-case job; HH#<hh>/JOB#<id> pointer
 *   HH#<hh>/INBOX#<at>#<id>  inbox items
 *   HH#<hh>/CASE#<id>        a household's generated case
 *   QUOTA#<day>/<scope>      daily counters
 */
export function createDynamoStores(opts: { table: string; bundled: Case[]; clock?: () => number; client?: DynamoDBClient }): Stores {
  const clock = opts.clock ?? Date.now;
  const db = DynamoDBDocumentClient.from(opts.client ?? new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const TableName = opts.table;
  const bundled = new Map(opts.bundled.map((c) => [c.meta.id, c]));
  const seconds = (ms: number) => Math.floor(ms / 1000);
  const guestTtl = (s: GameState) => (s.householdId === null ? seconds(s.updatedAt + GUEST_TTL_MS) : undefined);

  const getItem = async (pk: string, sk: string, consistent = false) =>
    (await db.send(new GetCommand({ TableName, Key: { pk, sk }, ConsistentRead: consistent }))).Item;
  const pause = (attempt: number) => new Promise((r) => setTimeout(r, 15 * 2 ** attempt + Math.random() * 20));
  const query = async (pk: string, prefix: string) =>
    (
      await db.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
          ExpressionAttributeValues: { ':pk': pk, ':p': prefix },
        }),
      )
    ).Items ?? [];

  const games: Stores['games'] = {
    async get(id) {
      const item = await getItem(`GAME#${id}`, 'STATE');
      const s = item?.state as GameState | undefined;
      return s && !isExpiredGuest(s, clock()) ? s : null;
    },
    async create(s) {
      await db.send(
        new PutCommand({
          TableName,
          Item: { pk: `GAME#${s.gameId}`, sk: 'STATE', state: s, version: s.version, ttl: guestTtl(s) },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      if (s.householdId) {
        await db.send(new PutCommand({ TableName, Item: { pk: `HH#${s.householdId}`, sk: `GAME#${s.gameId}` } }));
      }
    },
    async update(id, fn) {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) await pause(attempt);
        const item = await getItem(`GAME#${id}`, 'STATE', true);
        const current = item?.state as GameState | undefined;
        if (!current || isExpiredGuest(current, clock())) throw new Error(`no game ${id}`);
        const next: GameState = { ...fn(current), version: current.version + 1 };
        try {
          await db.send(
            new PutCommand({
              TableName,
              Item: { pk: `GAME#${id}`, sk: 'STATE', state: next, version: next.version, ttl: guestTtl(next) },
              ConditionExpression: 'version = :v',
              ExpressionAttributeValues: { ':v': current.version },
            }),
          );
          return next;
        } catch (err) {
          if (!(err instanceof ConditionalCheckFailedException)) throw err;
        }
      }
      throw new ConflictError();
    },
    async listByHousehold(hh) {
      const ids = (await query(`HH#${hh}`, 'GAME#')).map((i) => String(i.sk).slice(5));
      if (!ids.length) return [];
      const out: GameState[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const res = await db.send(
          new BatchGetCommand({
            RequestItems: { [TableName]: { Keys: ids.slice(i, i + 100).map((g) => ({ pk: `GAME#${g}`, sk: 'STATE' })) } },
          }),
        );
        out.push(...(res.Responses?.[TableName] ?? []).map((r) => r.state as GameState));
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt);
    },
  };

  return {
    games,
    entitlements: {
      async has(hh, sku) {
        return Number((await getItem(`HH#${hh}`, `ENT#${sku}`))?.credits ?? 0) > 0;
      },
      async grant(hh, sku, orderId) {
        try {
          await db.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Put: {
                    TableName,
                    Item: { pk: `ORDER#${orderId}`, sk: 'GRANT', householdId: hh, sku },
                    ConditionExpression: 'attribute_not_exists(pk)',
                  },
                },
                {
                  Update: {
                    TableName,
                    Key: { pk: `HH#${hh}`, sk: `ENT#${sku}` },
                    UpdateExpression: 'ADD credits :one SET lastOrder = :o',
                    ExpressionAttributeValues: { ':one': 1, ':o': orderId },
                  },
                },
              ],
            }),
          );
        } catch (err) {
          const already = err instanceof TransactionCanceledException && err.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed';
          if (!already) throw err;
        }
      },
      async consume(hh, sku) {
        try {
          await db.send(
            new UpdateCommand({
              TableName,
              Key: { pk: `HH#${hh}`, sk: `ENT#${sku}` },
              UpdateExpression: 'SET credits = credits - :one',
              ConditionExpression: 'credits > :zero',
              ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
            }),
          );
          return true;
        } catch (err) {
          if (err instanceof ConditionalCheckFailedException) return false;
          throw err;
        }
      },
    },
    checkouts: {
      async put(s) {
        await db.send(new PutCommand({ TableName, Item: { pk: `CHK#${s.id}`, sk: 'SESSION', session: s } }));
      },
      async get(id) {
        return ((await getItem(`CHK#${id}`, 'SESSION'))?.session as CheckoutSession | undefined) ?? null;
      },
      async claim(id, from, to, now, staleMs) {
        const values: Record<string, unknown> = { ':to': to, ':now': now, ':stale': now - staleMs };
        from.forEach((f, i) => (values[`:f${i}`] = f));
        try {
          const res = await db.send(
            new UpdateCommand({
              TableName,
              Key: { pk: `CHK#${id}`, sk: 'SESSION' },
              UpdateExpression: 'SET #s.#st = :to, #s.updatedAt = :now',
              ConditionExpression: `#s.#st IN (${from.map((_, i) => `:f${i}`).join(', ')}) OR (#s.#st = :to AND #s.updatedAt < :stale)`,
              ExpressionAttributeNames: { '#s': 'session', '#st': 'status' },
              ExpressionAttributeValues: values,
              ReturnValues: 'ALL_NEW',
            }),
          );
          return (res.Attributes?.session as CheckoutSession | undefined) ?? null;
        } catch (err) {
          if (err instanceof ConditionalCheckFailedException) return null;
          throw err;
        }
      },
      async getIdem(owner, key) {
        const item = await getItem(`IDEM#${owner}#${key}`, 'IDEM');
        if (!item || Number(item.ttl) < seconds(clock())) return null;
        return item.record as IdempotencyRecord;
      },
      async putIdem(owner, key, record) {
        await db.send(
          new PutCommand({ TableName, Item: { pk: `IDEM#${owner}#${key}`, sk: 'IDEM', record, ttl: seconds(clock() + 24 * 3_600_000) } }),
        );
      },
    },
    jobs: {
      async create(job) {
        await db.send(new PutCommand({ TableName, Item: { pk: `JOB#${job.jobId}`, sk: 'JOB', job } }));
        await db.send(new PutCommand({ TableName, Item: { pk: `HH#${job.householdId}`, sk: `JOB#${job.jobId}` } }));
      },
      async get(id) {
        return ((await getItem(`JOB#${id}`, 'JOB'))?.job as Job | undefined) ?? null;
      },
      async update(id, patch) {
        const current = (await getItem(`JOB#${id}`, 'JOB'))?.job as Job | undefined;
        if (!current) throw new Error(`no job ${id}`);
        const next = { ...current, ...patch, updatedAt: clock() };
        await db.send(new PutCommand({ TableName, Item: { pk: `JOB#${id}`, sk: 'JOB', job: next } }));
        return next;
      },
      async listByHousehold(hh) {
        const ids = (await query(`HH#${hh}`, 'JOB#')).map((i) => String(i.sk).slice(4));
        const jobsFound = await Promise.all(ids.map(async (j) => (await getItem(`JOB#${j}`, 'JOB'))?.job as Job | undefined));
        return jobsFound.filter((j): j is Job => Boolean(j));
      },
      async incrementToday(scope) {
        const res = await db.send(
          new UpdateCommand({
            TableName,
            Key: { pk: `QUOTA#${dayKey(clock())}`, sk: scope },
            UpdateExpression: 'ADD n :one SET #ttl = :ttl',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':one': 1, ':ttl': seconds(clock() + 3 * 24 * 3_600_000) },
            ReturnValues: 'UPDATED_NEW',
          }),
        );
        return Number(res.Attributes?.n ?? 0);
      },
      async countToday(scope) {
        return Number((await getItem(`QUOTA#${dayKey(clock())}`, scope))?.n ?? 0);
      },
    },
    inbox: {
      async add(hh, item) {
        await db.send(
          new PutCommand({ TableName, Item: { pk: `HH#${hh}`, sk: `INBOX#${String(item.at).padStart(15, '0')}#${item.id}`, item } }),
        );
      },
      async list(hh, since) {
        const items = (await query(`HH#${hh}`, 'INBOX#')).map((i) => i.item as InboxItem);
        return items.filter((i) => since === undefined || i.at > since).sort((a, b) => a.at - b.at);
      },
    },
    cases: {
      async list(hh) {
        const own = hh ? (await query(`HH#${hh}`, 'CASE#')).map((i) => metaOf(parseCase(i.case), true)) : [];
        return [...[...bundled.values()].map((c) => metaOf(c, false)), ...own];
      },
      async get(id, hh) {
        const b = bundled.get(id);
        if (b) return b;
        if (!hh) return null;
        const item = await getItem(`HH#${hh}`, `CASE#${id}`);
        return item ? parseCase(item.case) : null;
      },
      async putCustom(hh, c) {
        await db.send(new PutCommand({ TableName, Item: { pk: `HH#${hh}`, sk: `CASE#${c.meta.id}`, case: c } }));
      },
    },
  };
}
