import {randomUUID} from 'node:crypto';
import {closePostgresClient, createPostgresClient, type Pool} from '@shipfox/node-postgres';
import {count} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/node-postgres';
import {integer, pgTable, pgTableCreator, text} from 'drizzle-orm/pg-core';
import {createPostgresOutbox} from './postgres.js';
import {createPostgresOutboxTable} from './schema.js';
import type {IdempotentOutboxEvent} from './types.js';
import {writeIdempotentOutboxEvent} from './write.js';

const pgTableForOutbox = pgTableCreator((name) => `node_outbox_test_${name}`);
const outboxTable = createPostgresOutboxTable(pgTableForOutbox);
const domainTable = pgTable('node_outbox_test_domain', {
  id: integer('id').primaryKey(),
  value: text('value').notNull(),
});

const start = new Date('2030-01-01T00:00:00.000Z');
const event = {
  idempotencyKey: 'event-1',
  type: 'thing.created',
  payload: {id: 'thing-1'},
  createdAt: start,
  availableAt: start,
};

class TestDeliveryError extends Error {
  readonly reason = 'rate-limited';

  constructor() {
    super('delivery timed out', {cause: new Error('socket closed')});
    this.name = 'TestDeliveryError';
  }
}

let databaseName: string;
let pool: Pool;
let database: ReturnType<typeof drizzle>;
let serverVersionNum: number;

beforeAll(async () => {
  databaseName = `node_outbox_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = createPostgresClient({database: 'postgres'});
  const version = await adminPool.query<{server_version_num: string}>(
    "SELECT current_setting('server_version_num') AS server_version_num",
  );
  serverVersionNum = Number(version.rows[0]?.server_version_num);
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  await closePostgresClient();

  pool = createPostgresClient({database: databaseName});
  database = drizzle(pool);
  await pool.query(`
    CREATE TABLE node_outbox_test_domain (
      id integer PRIMARY KEY,
      value text NOT NULL
    );
    CREATE TABLE node_outbox_test_outbox (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      idempotency_key text NOT NULL,
      event_type text NOT NULL,
      ordering_key text,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      dispatched_at timestamptz,
      dispatch_attempts integer NOT NULL DEFAULT 0,
      next_dispatch_at timestamptz NOT NULL DEFAULT now(),
      lease_token uuid,
      lease_expires_at timestamptz,
      last_dispatch_error jsonb,
      last_dispatch_failed_at timestamptz,
      dead_lettered_at timestamptz
    );
    CREATE UNIQUE INDEX node_outbox_test_outbox_idempotency_key_idx
      ON node_outbox_test_outbox (idempotency_key);
    CREATE UNIQUE INDEX node_outbox_test_outbox_lease_token_idx
      ON node_outbox_test_outbox (lease_token);
    CREATE INDEX node_outbox_test_outbox_pending_idx
      ON node_outbox_test_outbox (next_dispatch_at, created_at, id)
      WHERE dispatched_at IS NULL AND dead_lettered_at IS NULL;
  `);
});

afterAll(async () => {
  await closePostgresClient();
  const adminPool = createPostgresClient({database: 'postgres'});
  await adminPool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
  await closePostgresClient();
});

beforeEach(async () => {
  await pool.query('TRUNCATE node_outbox_test_domain, node_outbox_test_outbox');
});

function createOutbox(options: {maxAttempts?: number; maxRetryDelayMs?: number} = {}) {
  return createPostgresOutbox({database, table: outboxTable, ...options});
}

async function append(
  input: Partial<IdempotentOutboxEvent<(typeof event)['payload']>> & {idempotencyKey: string},
): Promise<void> {
  await writeIdempotentOutboxEvent(database, outboxTable, {...event, ...input});
}

describe('PostgreSQL outbox contract', () => {
  it('runs against PostgreSQL 18', () => {
    expect(serverVersionNum).toBeGreaterThanOrEqual(180_000);
    expect(serverVersionNum).toBeLessThan(190_000);
  });

  it('commits a domain write and outbox event in one transaction', async () => {
    const result = await database.transaction(async (tx) => {
      await tx.insert(domainTable).values({id: 1, value: 'committed'});
      return await writeIdempotentOutboxEvent(tx, outboxTable, event);
    });

    const domainRows = await database.select().from(domainTable);
    const claimed = await createOutbox().claim({batchSize: 1, leaseDurationMs: 1_000, now: start});
    expect(result).toEqual({status: 'created'});
    expect(domainRows).toEqual([{id: 1, value: 'committed'}]);
    expect(claimed).toHaveLength(1);
  });

  it('rolls back both the domain write and outbox event', async () => {
    const transaction = database.transaction(async (tx) => {
      await tx.insert(domainTable).values({id: 1, value: 'rolled-back'});
      await writeIdempotentOutboxEvent(tx, outboxTable, event);
      throw new Error('rollback');
    });

    await expect(transaction).rejects.toThrow('rollback');
    const domainRows = await database.select().from(domainTable);
    const claimed = await createOutbox().claim({batchSize: 1, leaseDurationMs: 1_000, now: start});
    expect(domainRows).toEqual([]);
    expect(claimed).toEqual([]);
  });

  it('stores one durable event for a reused idempotency key', async () => {
    const first = await writeIdempotentOutboxEvent(database, outboxTable, event);
    const duplicate = await writeIdempotentOutboxEvent(database, outboxTable, {
      ...event,
      payload: {id: 'different-payload'},
    });

    const rows = await database.select({count: count()}).from(outboxTable);
    expect(first).toEqual({status: 'created'});
    expect(duplicate).toEqual({status: 'duplicate'});
    expect(rows).toEqual([{count: 1}]);
  });

  it('claims rows in deterministic availability and creation order', async () => {
    await Promise.all([
      append({idempotencyKey: 'event-3', createdAt: new Date(start.getTime() + 3_000)}),
      append({idempotencyKey: 'event-1', createdAt: new Date(start.getTime() + 1_000)}),
      append({idempotencyKey: 'event-2', createdAt: new Date(start.getTime() + 2_000)}),
    ]);

    const claimed = await createOutbox().claim({batchSize: 3, leaseDurationMs: 1_000, now: start});

    expect(claimed.map((delivery) => delivery.idempotencyKey)).toEqual([
      'event-1',
      'event-2',
      'event-3',
    ]);
  });

  it('keeps a newer ordering-key event pending until the older event is acknowledged', async () => {
    await append({idempotencyKey: 'event-1', orderingKey: 'aggregate-1'});
    await append({
      idempotencyKey: 'event-2',
      orderingKey: 'aggregate-1',
      createdAt: new Date(start.getTime() + 1),
    });
    const outbox = createOutbox();

    const firstClaim = await outbox.claim({batchSize: 2, leaseDurationMs: 1_000, now: start});
    const [first] = firstClaim;
    if (!first) throw new Error('Expected the first ordered delivery');
    await outbox.acknowledge({...first, now: start});
    const second = await outbox.claim({batchSize: 2, leaseDurationMs: 1_000, now: start});

    expect(firstClaim.map((delivery) => delivery.idempotencyKey)).toEqual(['event-1']);
    expect(second.map((delivery) => delivery.idempotencyKey)).toEqual(['event-2']);
  });

  it('gives concurrent workers disjoint bounded claims', async () => {
    await Promise.all(
      Array.from({length: 8}, (_, index) => append({idempotencyKey: `event-${index}`})),
    );
    const outbox = createOutbox();

    const [left, right] = await Promise.all([
      outbox.claim({batchSize: 4, leaseDurationMs: 1_000, now: start}),
      outbox.claim({batchSize: 4, leaseDurationMs: 1_000, now: start}),
    ]);

    const leftIds = new Set(left.map((delivery) => delivery.id));
    const rightIds = new Set(right.map((delivery) => delivery.id));
    expect(left).toHaveLength(4);
    expect(right).toHaveLength(4);
    expect([...leftIds].filter((id) => rightIds.has(id))).toEqual([]);
  });

  it('redelivers an expired lease with a new token and incremented attempt count', async () => {
    await append({idempotencyKey: 'event-1'});
    const outbox = createOutbox();
    const [first] = await outbox.claim({batchSize: 1, leaseDurationMs: 1_000, now: start});

    const [second] = await outbox.claim({
      batchSize: 1,
      leaseDurationMs: 1_000,
      now: new Date(start.getTime() + 1_001),
    });

    expect(second?.id).toBe(first?.id);
    expect(second?.attempts).toBe(2);
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
  });

  it('dead-letters an expired final attempt instead of claiming it again', async () => {
    await append({idempotencyKey: 'event-1'});
    const outbox = createOutbox({maxAttempts: 1});
    await outbox.claim({batchSize: 1, leaseDurationMs: 1_000, now: start});

    const claimed = await outbox.claim({
      batchSize: 1,
      leaseDurationMs: 1_000,
      now: new Date(start.getTime() + 1_001),
    });
    const health = await outbox.health({now: new Date(start.getTime() + 1_001)});

    expect(claimed).toEqual([]);
    expect(health.pendingCount).toBe(0);
  });

  it('does not let an older lease acknowledge or retry a newer claim', async () => {
    await append({idempotencyKey: 'event-1'});
    const outbox = createOutbox();
    const [first] = await outbox.claim({batchSize: 1, leaseDurationMs: 1_000, now: start});
    const redeliveryTime = new Date(start.getTime() + 1_001);
    const [second] = await outbox.claim({
      batchSize: 1,
      leaseDurationMs: 1_000,
      now: redeliveryTime,
    });
    if (!first || !second) throw new Error('Expected both delivery attempts');

    const acknowledgement = await outbox.acknowledge({...first, now: redeliveryTime});
    const retry = await outbox.retry({
      ...first,
      delayMs: 0,
      failure: {message: 'old'},
      now: redeliveryTime,
    });
    const currentAcknowledgement = await outbox.acknowledge({
      ...second,
      now: new Date(redeliveryTime.getTime() + 1),
    });

    expect(acknowledgement).toEqual({status: 'stale'});
    expect(retry).toEqual({status: 'stale'});
    expect(currentAcknowledgement).toEqual({status: 'acknowledged'});
  });

  it('bounds retry delay and dead-letters the final failed attempt', async () => {
    await append({idempotencyKey: 'event-1'});
    const outbox = createOutbox({maxAttempts: 3, maxRetryDelayMs: 1_000});
    const [first] = await outbox.claim({batchSize: 1, leaseDurationMs: 10_000, now: start});
    if (!first) throw new Error('Expected the first delivery');

    const firstRetry = await outbox.retry({
      ...first,
      delayMs: 5_000,
      failure: {message: 'first'},
      now: start,
    });
    const beforeBackoff = await outbox.claim({
      batchSize: 1,
      leaseDurationMs: 10_000,
      now: new Date(start.getTime() + 999),
    });
    const [second] = await outbox.claim({
      batchSize: 1,
      leaseDurationMs: 10_000,
      now: new Date(start.getTime() + 1_000),
    });
    if (!second) throw new Error('Expected the second delivery');
    await outbox.retry({
      ...second,
      delayMs: 0,
      failure: {message: 'second'},
      now: new Date(start.getTime() + 1_001),
    });
    const [third] = await outbox.claim({
      batchSize: 1,
      leaseDurationMs: 10_000,
      now: new Date(start.getTime() + 1_001),
    });
    if (!third) throw new Error('Expected the third delivery');

    const finalRetry = await outbox.retry({
      ...third,
      delayMs: 0,
      failure: {message: 'final'},
      now: new Date(start.getTime() + 1_002),
    });
    const stored = await database
      .select({
        attempts: outboxTable.dispatchAttempts,
        deadLetteredAt: outboxTable.deadLetteredAt,
        lastFailure: outboxTable.lastDispatchError,
      })
      .from(outboxTable);

    expect(firstRetry).toEqual({
      status: 'retry-scheduled',
      nextAttemptAt: new Date(start.getTime() + 1_000),
    });
    expect(beforeBackoff).toEqual([]);
    expect(finalRetry).toEqual({status: 'dead-lettered'});
    expect(stored).toEqual([
      {
        attempts: 3,
        deadLetteredAt: new Date(start.getTime() + 1_002),
        lastFailure: {message: 'final'},
      },
    ]);
  });

  it('stores Error details and typed fields as JSON failure data', async () => {
    await append({idempotencyKey: 'event-1'});
    const outbox = createOutbox();
    const [delivery] = await outbox.claim({batchSize: 1, leaseDurationMs: 1_000, now: start});
    if (!delivery) throw new Error('Expected an outbox delivery');
    const failure = new TestDeliveryError();

    await outbox.retry({...delivery, delayMs: 0, failure, now: start});
    const [stored] = await database
      .select({lastFailure: outboxTable.lastDispatchError})
      .from(outboxTable);

    expect(stored?.lastFailure).toEqual(
      expect.objectContaining({
        name: 'TestDeliveryError',
        message: 'delivery timed out',
        reason: 'rate-limited',
        stack: expect.stringContaining('TestDeliveryError: delivery timed out'),
        cause: expect.objectContaining({
          name: 'Error',
          message: 'socket closed',
          stack: expect.stringContaining('Error: socket closed'),
        }),
      }),
    );
  });

  it('reports the oldest pending event age and excludes acknowledged events', async () => {
    const createdAt = new Date(start.getTime() - 5_000);
    await append({idempotencyKey: 'event-1', createdAt, availableAt: createdAt});
    const outbox = createOutbox();

    const pending = await outbox.health({now: start});
    const [delivery] = await outbox.claim({batchSize: 1, leaseDurationMs: 1_000, now: start});
    if (!delivery) throw new Error('Expected an outbox delivery');
    await outbox.acknowledge({...delivery, now: start});
    const empty = await outbox.health({now: start});

    expect(pending).toEqual({
      status: 'ready',
      checkedAt: start,
      pendingCount: 1,
      oldestPendingAt: createdAt,
      oldestPendingAgeMs: 5_000,
    });
    expect(empty).toEqual({status: 'ready', checkedAt: start, pendingCount: 0});
  });
});
