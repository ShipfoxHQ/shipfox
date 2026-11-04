import {randomUUID} from 'node:crypto';
import {createOutboxTable} from '@shipfox/node-outbox';
import {closePostgresClient, createPostgresClient, type Pool} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {drizzle, type NodePgDatabase} from 'drizzle-orm/node-postgres';
import {pgTableCreator} from 'drizzle-orm/pg-core';
import {
  BATCH_SIZE,
  countPendingOutboxRows as countPendingOutboxRowsInRegistry,
  createOutboxRegistry,
  drainAll as drainFromRegistry,
  markDispatched as markDispatchedFromRegistry,
  type OutboxDispatchClaim,
  type OutboxDispatchFailure,
  type PruneDispatchedOutboxRowsOptions,
  pruneDispatchedOutboxRows as pruneFromRegistry,
  recordDispatchFailure as recordFailureFromRegistry,
  registerPublisher as registerInRegistry,
  renewDispatchClaim as renewFromRegistry,
} from './publisher-registry.js';
import type {ModulePublisher} from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1_000;
const EVENT_TYPE = 'thing.created';
const outboxTable = createOutboxTable(pgTableCreator((name) => `node_module_test_${name}`));

let databaseName: string;
let pool: Pool;
let database: NodePgDatabase<Record<string, unknown>>;

function db() {
  return database;
}

beforeAll(async () => {
  databaseName = `node_module_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = createPostgresClient({database: 'postgres'});
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  await closePostgresClient();

  pool = createPostgresClient({database: databaseName});
  database = drizzle(pool);
  await pool.query(`
    CREATE TABLE node_module_test_outbox (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      event_type text NOT NULL,
      ordering_key text,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      dispatched_at timestamptz,
      dispatch_attempts integer NOT NULL DEFAULT 0,
      next_dispatch_at timestamptz NOT NULL DEFAULT now(),
      last_dispatch_error jsonb,
      last_dispatch_failed_at timestamptz,
      dead_lettered_at timestamptz
    );
    CREATE INDEX node_module_test_outbox_pending_idx
      ON node_module_test_outbox (next_dispatch_at, created_at)
      WHERE dispatched_at IS NULL AND dead_lettered_at IS NULL;
    CREATE INDEX node_module_test_outbox_dispatched_retention_idx
      ON node_module_test_outbox (dispatched_at, id)
      WHERE dispatched_at IS NOT NULL;
  `);
});

afterAll(async () => {
  await closePostgresClient();
  const adminPool = createPostgresClient({database: 'postgres'});
  await adminPool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
  await closePostgresClient();
});

let outboxRegistry = createOutboxRegistry();

function resetPublishers(): void {
  outboxRegistry = createOutboxRegistry();
}

function registerPublisher(publisher: ModulePublisher): void {
  registerInRegistry(outboxRegistry, publisher);
}

function drainAll(options?: {partition?: {workerIndex: number; workerCount: number}}) {
  return drainFromRegistry(outboxRegistry, options);
}

function countPendingOutboxRows() {
  return countPendingOutboxRowsInRegistry(outboxRegistry);
}

function markDispatched(source: string, claims: string[] | OutboxDispatchClaim[]) {
  return markDispatchedFromRegistry(outboxRegistry, source, claims);
}

function renewDispatchClaim(source: string, claim: OutboxDispatchClaim) {
  return renewFromRegistry(outboxRegistry, source, claim);
}

// Claim leases are truncated to milliseconds, so a renewal in the same millisecond as the
// drain would keep the original claim current instead of making it stale.
async function renewDispatchClaimLater(source: string, claim: OutboxDispatchClaim) {
  await new Promise((resolve) => setTimeout(resolve, 2));
  const renewed = await renewDispatchClaim(source, claim);
  expect(renewed?.getTime()).toBeGreaterThan(claim.claimExpiresAt.getTime());
  return renewed;
}

function recordDispatchFailure(
  source: string,
  id: string,
  failure: OutboxDispatchFailure,
  claimExpiresAt?: Date,
) {
  return recordFailureFromRegistry(outboxRegistry, source, id, failure, claimExpiresAt);
}

function pruneDispatchedOutboxRows(options: PruneDispatchedOutboxRowsOptions) {
  return pruneFromRegistry(outboxRegistry, options);
}

async function listRegistryRows() {
  return await db().select().from(outboxTable);
}

async function insertOutboxRow(params: {
  marker: string;
  orderingKey?: string | null;
  createdAt?: Date;
  nextDispatchAt?: Date;
  dispatchedAt?: Date | null;
  deadLetteredAt?: Date | null;
}) {
  const id = randomUUID();
  await db()
    .insert(outboxTable)
    .values({
      id,
      eventType: EVENT_TYPE,
      orderingKey: params.orderingKey ?? null,
      payload: {marker: params.marker},
      createdAt: params.createdAt,
      nextDispatchAt: params.nextDispatchAt,
      dispatchedAt: params.dispatchedAt ?? null,
      deadLetteredAt: params.deadLetteredAt ?? null,
    });
  return id;
}

describe('publisher registry against PostgreSQL', () => {
  beforeEach(async () => {
    await db().delete(outboxTable);
    resetPublishers();
    registerPublisher({
      name: 'module-a',
      table: outboxTable,
      db: () => db(),
    });
  });

  afterEach(() => {
    resetPublishers();
  });

  test('countPendingOutboxRows counts pending rows but excludes dispatched and dead-lettered rows', async () => {
    await insertOutboxRow({marker: 'pending'});
    await insertOutboxRow({marker: 'dispatched', dispatchedAt: new Date()});
    await insertOutboxRow({marker: 'dead-lettered', deadLetteredAt: new Date()});

    const pendingRows = await countPendingOutboxRows();

    expect(pendingRows).toBe(1);
  });

  test('countPendingOutboxRows sums pending rows across every registered publisher', async () => {
    registerPublisher({name: 'module-b', table: outboxTable, db: () => db()});
    await insertOutboxRow({marker: 'pending'});

    const pendingRows = await countPendingOutboxRows();

    expect(pendingRows).toBe(2);
  });

  test('drainAll returns undispatched outbox events', async () => {
    await insertOutboxRow({marker: 'test.yml'});

    const projectEvents = (await drainAll()).events;

    expect(projectEvents).toHaveLength(1);
    expect(projectEvents[0]?.source).toBe('module-a');
    expect(projectEvents[0]?.orderingKey).toBe('module-a');
    expect(projectEvents[0]?.event.type).toBe(EVENT_TYPE);
  });

  test('drainAll resolves orderingKey from the column', async () => {
    await insertOutboxRow({marker: 'keyed', orderingKey: 'run-1'});

    const projectEvents = (await drainAll()).events;

    expect(projectEvents).toHaveLength(1);
    expect(projectEvents[0]?.orderingKey).toBe('run-1');
  });

  test('drainAll blocks later same-key rows while an earlier row waits for retry', async () => {
    const base = new Date(Date.now() - 60_000);
    const retry = await insertOutboxRow({
      marker: 'retry',
      orderingKey: 'run-1',
      createdAt: base,
      nextDispatchAt: new Date(Date.now() + 60 * 60_000),
    });
    await insertOutboxRow({
      marker: 'later-same-key',
      orderingKey: 'run-1',
      createdAt: new Date(base.getTime() + 1_000),
    });
    await insertOutboxRow({
      marker: 'other-key',
      orderingKey: 'run-2',
      createdAt: new Date(base.getTime() + 2_000),
    });

    const events = (await drainAll()).events;

    expect(events.map((event) => event.id)).not.toContain(retry);
    expect(events.map((event) => event.event.payload)).toEqual([{marker: 'other-key'}]);
  });

  test('drainAll reports hasMore when a source returns a full batch', async () => {
    const rows = Array.from({length: BATCH_SIZE}, (_, index) => ({
      id: randomUUID(),
      eventType: EVENT_TYPE,
      payload: {marker: `batch-${index}`},
    }));
    await db().insert(outboxTable).values(rows);

    const drain = await drainAll();

    expect(drain.events).toHaveLength(BATCH_SIZE);
    expect(drain.hasMore).toBe(true);
  });

  test('concurrent drainAll calls claim each row at most once', async () => {
    await insertOutboxRow({marker: 'first', orderingKey: 'run-1'});
    await insertOutboxRow({marker: 'second', orderingKey: 'run-2'});

    const [firstDrain, secondDrain] = await Promise.all([drainAll(), drainAll()]);

    const firstEvents = firstDrain.events;
    const secondEvents = secondDrain.events;
    const firstIds = new Set(firstEvents.map((event) => event.id));
    const duplicateIds = secondEvents
      .map((event) => event.id)
      .filter((eventId) => firstIds.has(eventId));
    expect(firstEvents.length + secondEvents.length).toBe(2);
    expect(duplicateIds).toEqual([]);
  });

  test('drainAll leases claimed rows so a crashed worker redelivers after the lease expires', async () => {
    const id = await insertOutboxRow({marker: 'leased', orderingKey: 'run-1'});

    const firstDrain = (await drainAll()).events;
    const secondDrain = (await drainAll()).events;
    await db()
      .update(outboxTable)
      .set({nextDispatchAt: sql`now() - interval '1 second'`})
      .where(sql`${outboxTable.id} = ${id}`);
    const redeliveryDrain = (await drainAll()).events;

    expect(firstDrain.map((event) => event.id)).toEqual([id]);
    expect(secondDrain).toHaveLength(0);
    expect(redeliveryDrain.map((event) => event.id)).toEqual([id]);
  });

  test('renewDispatchClaim extends only the currently owned claim', async () => {
    await insertOutboxRow({marker: 'renewed', orderingKey: 'run-1'});
    const [event] = (await drainAll()).events;

    const renewedClaimExpiresAt = await renewDispatchClaimLater('module-a', {
      id: event?.id as string,
      claimExpiresAt: event?.claimExpiresAt as Date,
    });
    const staleRenewal = await renewDispatchClaim('module-a', {
      id: event?.id as string,
      claimExpiresAt: event?.claimExpiresAt as Date,
    });

    expect(renewedClaimExpiresAt).toBeInstanceOf(Date);
    expect(staleRenewal).toBeUndefined();
  });

  test('markDispatched ignores stale claims that have already been renewed', async () => {
    await insertOutboxRow({marker: 'stale-success', orderingKey: 'run-1'});
    const [event] = (await drainAll()).events;
    await renewDispatchClaimLater('module-a', {
      id: event?.id as string,
      claimExpiresAt: event?.claimExpiresAt as Date,
    });

    await markDispatched('module-a', [
      {id: event?.id as string, claimExpiresAt: event?.claimExpiresAt as Date},
    ]);

    const rows = await listRegistryRows();
    expect(rows[0]?.dispatchedAt).toBeNull();
  });

  test('recordDispatchFailure ignores stale claims that have already been renewed', async () => {
    const failure: OutboxDispatchFailure = {
      kind: 'handler',
      eventType: EVENT_TYPE,
      eventId: randomUUID(),
      errorName: 'Error',
      errorMessage: 'subscriber failed',
    };
    await insertOutboxRow({marker: 'stale-failure', orderingKey: 'run-1'});
    const [event] = (await drainAll()).events;
    await renewDispatchClaimLater('module-a', {
      id: event?.id as string,
      claimExpiresAt: event?.claimExpiresAt as Date,
    });

    await recordDispatchFailure(
      'module-a',
      event?.id as string,
      failure,
      event?.claimExpiresAt as Date,
    );

    const rows = await listRegistryRows();
    expect(rows[0]?.dispatchAttempts).toBe(0);
    expect(rows[0]?.lastDispatchError).toBeNull();
  });

  test('partitioned drainAll assigns the same ordering key to one worker', async () => {
    await insertOutboxRow({marker: 'shared-1', orderingKey: 'run-shared'});
    await insertOutboxRow({marker: 'shared-2', orderingKey: 'run-shared'});
    await insertOutboxRow({marker: 'other-1', orderingKey: 'run-other-1'});
    await insertOutboxRow({marker: 'other-2', orderingKey: 'run-other-2'});
    const workerCount = 4;

    const drains = await Promise.all(
      Array.from({length: workerCount}, (_, workerIndex) =>
        drainAll({partition: {workerIndex, workerCount}}),
      ),
    );

    const partitionsByKey = new Map<string, Set<number>>();
    const projectEvents = drains.flatMap((drain, workerIndex) =>
      drain.events.map((event) => ({...event, workerIndex})),
    );
    for (const event of projectEvents) {
      const workers = partitionsByKey.get(event.orderingKey) ?? new Set<number>();
      workers.add(event.workerIndex);
      partitionsByKey.set(event.orderingKey, workers);
    }
    const sharedEvents = projectEvents.filter((event) => event.orderingKey === 'run-shared');
    expect(projectEvents).toHaveLength(4);
    expect(sharedEvents).toHaveLength(2);
    expect(partitionsByKey.get('run-shared')?.size).toBe(1);
  });

  test('markDispatched sets dispatchedAt for a single event', async () => {
    await insertOutboxRow({marker: 'test.yml'});
    const events = (await drainAll()).events;

    await markDispatched('module-a', [events[0]?.id as string]);

    const rows = await listRegistryRows();
    const dispatched = rows.filter((row) => row.dispatchedAt !== null);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.id).toBe(events[0]?.id);
  });

  test('markDispatched sets dispatchedAt for multiple events', async () => {
    await insertOutboxRow({marker: 'a.yml'});
    await insertOutboxRow({marker: 'b.yml'});
    const events = (await drainAll()).events;
    const ids = events.map((e) => e.id);

    await markDispatched('module-a', ids);

    const rows = await listRegistryRows();
    const pending = rows.filter((row) => row.dispatchedAt === null);
    expect(pending).toHaveLength(0);
  });

  test('drainAll skips already-dispatched events', async () => {
    await insertOutboxRow({marker: 'test.yml'});
    const events = (await drainAll()).events;
    await markDispatched('module-a', [events[0]?.id as string]);

    const secondDrain = (await drainAll()).events;

    expect(secondDrain).toHaveLength(0);
  });

  test('drainAll skips rows scheduled for a future retry', async () => {
    await insertOutboxRow({marker: 'retry.yml'});
    const events = (await drainAll()).events;
    await db()
      .update(outboxTable)
      .set({nextDispatchAt: sql`now() + interval '1 hour'`})
      .where(sql`${outboxTable.id} = ${events[0]?.id as string}`);

    const secondDrain = (await drainAll()).events;

    expect(secondDrain).toHaveLength(0);
  });

  test('recordDispatchFailure increments attempts, stores sanitized error metadata, and delays retry', async () => {
    const failure: OutboxDispatchFailure = {
      kind: 'validation',
      eventType: EVENT_TYPE,
      eventId: randomUUID(),
      issues: [{path: ['definitionId'], code: 'invalid_type', message: 'expected string'}],
    };
    await insertOutboxRow({marker: 'failure.yml'});
    const before = new Date();
    const events = (await drainAll()).events;

    await recordDispatchFailure('module-a', events[0]?.id as string, failure);

    const after = new Date();
    const rows = await listRegistryRows();
    const secondDrain = (await drainAll()).events;
    expect(rows[0]?.dispatchAttempts).toBe(1);
    expect(rows[0]?.lastDispatchError).toEqual(failure);
    expect(rows[0]?.lastDispatchFailedAt).toBeInstanceOf(Date);
    expect(rows[0]?.nextDispatchAt.getTime()).toBeGreaterThanOrEqual(before.getTime() + 9_000);
    expect(rows[0]?.nextDispatchAt.getTime()).toBeLessThanOrEqual(after.getTime() + 11_000);
    expect(rows[0]?.deadLetteredAt).toBeNull();
    expect(rows[0]?.dispatchedAt).toBeNull();
    expect(secondDrain).toHaveLength(0);
  });

  test('recordDispatchFailure dead-letters on the fifth failed attempt and excludes the row from future drains', async () => {
    const failure: OutboxDispatchFailure = {
      kind: 'handler',
      eventType: EVENT_TYPE,
      eventId: randomUUID(),
      errorName: 'Error',
      errorMessage: 'subscriber failed',
    };
    await insertOutboxRow({marker: 'poison.yml'});
    const events = (await drainAll()).events;
    await db()
      .update(outboxTable)
      .set({dispatchAttempts: 4})
      .where(sql`${outboxTable.id} = ${events[0]?.id as string}`);

    await recordDispatchFailure('module-a', events[0]?.id as string, failure);

    const rows = await listRegistryRows();
    const secondDrain = (await drainAll()).events;
    expect(rows[0]?.dispatchAttempts).toBe(5);
    expect(rows[0]?.lastDispatchError).toEqual(failure);
    expect(rows[0]?.deadLetteredAt).toBeInstanceOf(Date);
    expect(rows[0]?.dispatchedAt).toBeNull();
    expect(secondDrain).toHaveLength(0);
  });

  test('markDispatched leaves dead-lettered rows inspectable as undispatched', async () => {
    await insertOutboxRow({marker: 'dead.yml'});
    const events = (await drainAll()).events;
    await db()
      .update(outboxTable)
      .set({deadLetteredAt: sql`now()`})
      .where(sql`${outboxTable.id} = ${events[0]?.id as string}`);

    await markDispatched('module-a', [events[0]?.id as string]);

    const rows = await listRegistryRows();
    expect(rows[0]?.dispatchedAt).toBeNull();
    expect(rows[0]?.deadLetteredAt).toBeInstanceOf(Date);
  });

  test('recordDispatchFailure does not mutate already-dispatched rows', async () => {
    const failure: OutboxDispatchFailure = {
      kind: 'handler',
      eventType: EVENT_TYPE,
      eventId: randomUUID(),
      errorName: 'Error',
      errorMessage: 'subscriber failed',
    };
    await insertOutboxRow({marker: 'dispatched.yml'});
    const events = (await drainAll()).events;
    await markDispatched('module-a', [events[0]?.id as string]);

    await recordDispatchFailure('module-a', events[0]?.id as string, failure);

    const rows = await listRegistryRows();
    expect(rows[0]?.dispatchAttempts).toBe(0);
    expect(rows[0]?.lastDispatchError).toBeNull();
    expect(rows[0]?.dispatchedAt).toBeInstanceOf(Date);
  });

  test.each([
    {priorAttempts: 1, delaySeconds: 60},
    {priorAttempts: 2, delaySeconds: 300},
    {priorAttempts: 3, delaySeconds: 1800},
  ])('recordDispatchFailure backs off retry by ~$delaySeconds s after $priorAttempts prior attempts', async ({
    priorAttempts,
    delaySeconds,
  }) => {
    const failure: OutboxDispatchFailure = {
      kind: 'handler',
      eventType: EVENT_TYPE,
      eventId: randomUUID(),
      errorName: 'Error',
      errorMessage: 'subscriber failed',
    };
    await insertOutboxRow({marker: `backoff-${priorAttempts}.yml`});
    const events = (await drainAll()).events;
    await db()
      .update(outboxTable)
      .set({dispatchAttempts: priorAttempts})
      .where(sql`${outboxTable.id} = ${events[0]?.id as string}`);
    const before = new Date();

    await recordDispatchFailure('module-a', events[0]?.id as string, failure);

    const after = new Date();
    const rows = await listRegistryRows();
    const delayMs = delaySeconds * 1_000;
    expect(rows[0]?.dispatchAttempts).toBe(priorAttempts + 1);
    expect(rows[0]?.deadLetteredAt).toBeNull();
    expect(rows[0]?.nextDispatchAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime() + delayMs - 1_000,
    );
    expect(rows[0]?.nextDispatchAt.getTime()).toBeLessThanOrEqual(
      after.getTime() + delayMs + 1_000,
    );
  });

  test('redrains a failed row once its retry delay passes, then dispatches it', async () => {
    const failure: OutboxDispatchFailure = {
      kind: 'handler',
      eventType: EVENT_TYPE,
      eventId: randomUUID(),
      errorName: 'Error',
      errorMessage: 'subscriber failed',
    };
    await insertOutboxRow({marker: 'recover.yml'});
    const events = (await drainAll()).events;
    await recordDispatchFailure('module-a', events[0]?.id as string, failure);
    await db()
      .update(outboxTable)
      .set({nextDispatchAt: sql`now() - interval '1 second'`})
      .where(sql`${outboxTable.id} = ${events[0]?.id as string}`);

    const retryDrain = (await drainAll()).events;
    await markDispatched(
      'module-a',
      retryDrain.map((event) => event.id),
    );

    const rows = await listRegistryRows();
    const finalDrain = (await drainAll()).events;
    expect(retryDrain).toHaveLength(1);
    expect(retryDrain[0]?.id).toBe(events[0]?.id);
    expect(rows[0]?.dispatchAttempts).toBe(1);
    expect(rows[0]?.dispatchedAt).toBeInstanceOf(Date);
    expect(finalDrain).toHaveLength(0);
  });

  test('pruneDispatchedOutboxRows deletes only dispatched rows older than retention', async () => {
    const oldDispatchedAt = new Date(Date.now() - 8 * MS_PER_DAY);
    const recentDispatchedAt = new Date(Date.now() - 6 * MS_PER_DAY);
    await insertOutboxRow({marker: 'old-dispatched', dispatchedAt: oldDispatchedAt});
    await insertOutboxRow({marker: 'recent-dispatched', dispatchedAt: recentDispatchedAt});
    await insertOutboxRow({marker: 'old-pending'});
    await insertOutboxRow({marker: 'dead-lettered', deadLetteredAt: oldDispatchedAt});

    const result = await pruneDispatchedOutboxRows({
      retentionDays: 7,
      batchSize: 10,
      maxBatchesPerSource: 2,
    });

    const remaining = await listRegistryRows();
    const markers = remaining.map((row) => (row.payload as {marker: string}).marker).sort();
    expect(result).toEqual([{source: 'module-a', deleted: 1, capped: false}]);
    expect(markers).toEqual(['dead-lettered', 'old-pending', 'recent-dispatched']);
  });

  test('pruneDispatchedOutboxRows continues across batches', async () => {
    const oldDispatchedAt = new Date(Date.now() - 8 * MS_PER_DAY);
    await insertOutboxRow({marker: 'old-1', dispatchedAt: oldDispatchedAt});
    await insertOutboxRow({marker: 'old-2', dispatchedAt: oldDispatchedAt});
    await insertOutboxRow({marker: 'old-3', dispatchedAt: oldDispatchedAt});

    const result = await pruneDispatchedOutboxRows({
      retentionDays: 7,
      batchSize: 2,
      maxBatchesPerSource: 2,
    });

    const remaining = await listRegistryRows();
    expect(result).toEqual([{source: 'module-a', deleted: 3, capped: false}]);
    expect(remaining).toHaveLength(0);
  });

  test('pruneDispatchedOutboxRows reports capped sources', async () => {
    const oldDispatchedAt = new Date(Date.now() - 8 * MS_PER_DAY);
    await insertOutboxRow({marker: 'old-1', dispatchedAt: oldDispatchedAt});
    await insertOutboxRow({marker: 'old-2', dispatchedAt: oldDispatchedAt});
    await insertOutboxRow({marker: 'old-3', dispatchedAt: oldDispatchedAt});

    const result = await pruneDispatchedOutboxRows({
      retentionDays: 7,
      batchSize: 2,
      maxBatchesPerSource: 1,
    });

    const remaining = await listRegistryRows();
    expect(result).toEqual([{source: 'module-a', deleted: 2, capped: true}]);
    expect(remaining).toHaveLength(1);
  });

  test('pruneDispatchedOutboxRows returns zero when no rows are eligible', async () => {
    await insertOutboxRow({
      marker: 'recent-dispatched',
      dispatchedAt: new Date(Date.now() - 6 * MS_PER_DAY),
    });

    const result = await pruneDispatchedOutboxRows({
      retentionDays: 7,
      batchSize: 10,
      maxBatchesPerSource: 2,
    });

    const remaining = await listRegistryRows();
    expect(result).toEqual([{source: 'module-a', deleted: 0, capped: false}]);
    expect(remaining).toHaveLength(1);
  });
});
