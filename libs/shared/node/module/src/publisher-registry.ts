import type {DomainEvent, OutboxTable} from '@shipfox/node-outbox';
import {and, eq, getTableName, inArray, isNull, type SQL, sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {ZodType} from 'zod';

interface PublisherSource {
  name: string;
  table: OutboxTable;
  db: () => NodePgDatabase<Record<string, unknown>>;
  eventSchemas?: Record<string, ZodType>;
}

export interface DrainedEvent {
  source: string;
  orderingKey: string;
  id: string;
  event: DomainEvent;
}

export interface DrainAllResult {
  events: DrainedEvent[];
  hasMore: boolean;
}

export interface OutboxDispatcherPartition {
  workerIndex: number;
  workerCount: number;
}

export interface DrainAllOptions {
  partition?: OutboxDispatcherPartition;
}

export interface OutboxDispatchIssue {
  path: Array<string | number>;
  code: string;
  message: string;
}

export type OutboxDispatchFailure =
  | {
      kind: 'validation';
      eventType: string;
      eventId: string;
      issues: OutboxDispatchIssue[];
    }
  | {
      kind: 'handler';
      eventType: string;
      eventId: string;
      errorName: string;
      errorMessage: string;
    };

export interface PruneDispatchedOutboxRowsOptions {
  retentionDays: number;
  batchSize: number;
  maxBatchesPerSource: number;
}

export interface PrunedOutboxSource {
  source: string;
  deleted: number;
  capped: boolean;
}

const _sources: PublisherSource[] = [];
const _schemasByType = new Map<string, ZodType>();

export const BATCH_SIZE = 500;
const MAX_DISPATCH_ATTEMPTS = 5;
const CLAIM_LEASE_SECONDS = 120;

export function registerPublisher(config: PublisherSource): void {
  _sources.push(config);

  for (const [type, schema] of Object.entries(config.eventSchemas ?? {})) {
    const existing = _schemasByType.get(type);
    // Each event type is namespaced to one owning module, so two publishers claiming the
    // same type is a misconfiguration. Fail loudly at startup rather than silently keeping
    // one and masking the drift. A module re-registering its own schema is a no-op.
    if (existing && existing !== schema) {
      throw new Error(
        `Conflicting outbox event schema for "${type}": registered by more than one publisher. Each event type must have exactly one owning publisher.`,
      );
    }
    _schemasByType.set(type, schema);
  }
}

export function getEventSchema(type: string): ZodType | undefined {
  return _schemasByType.get(type);
}

export async function drainAll(options: DrainAllOptions = {}): Promise<DrainAllResult> {
  const partition = normalizePartition(options.partition);
  const results: DrainedEvent[] = [];
  let hasMore = false;

  for (const source of _sources) {
    const rows = await claimSourceRows(source, partition);
    if (rows.length === BATCH_SIZE) hasMore = true;

    for (const row of rows) {
      const createdAt = new Date(row.createdAt);
      results.push({
        source: source.name,
        orderingKey: row.orderingKey ?? source.name,
        id: row.id,
        event: {
          id: row.id,
          type: row.eventType,
          payload: row.payload,
          createdAt,
        },
      });
    }
  }

  return {events: results, hasMore};
}

type ClaimedOutboxRow = Record<string, unknown> & {
  id: string;
  eventType: string;
  orderingKey: string | null;
  payload: unknown;
  createdAt: Date | string;
};

async function claimSourceRows(
  source: PublisherSource,
  partition: OutboxDispatcherPartition,
): Promise<ClaimedOutboxRow[]> {
  const table = sql.raw(quoteIdentifier(getTableName(source.table)));
  const result = await source.db().transaction(async (tx) => {
    return await tx.execute<ClaimedOutboxRow>(sql`
      WITH claimed AS (
        SELECT outbox.id
        FROM ${table} AS outbox
        WHERE outbox.dispatched_at IS NULL
          AND outbox.dead_lettered_at IS NULL
          AND outbox.next_dispatch_at <= now()
          AND ${partitionPredicateSql(source, partition)}
          AND NOT EXISTS (
            SELECT 1
            FROM ${table} AS earlier
            WHERE earlier.dispatched_at IS NULL
              AND earlier.dead_lettered_at IS NULL
              AND COALESCE(earlier.ordering_key, ${source.name}) = COALESCE(outbox.ordering_key, ${source.name})
              AND (earlier.created_at, earlier.id) < (outbox.created_at, outbox.id)
              AND earlier.next_dispatch_at > now()
          )
        ORDER BY outbox.created_at, outbox.id
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH_SIZE}
      )
      UPDATE ${table} AS outbox
      SET next_dispatch_at = now() + (${CLAIM_LEASE_SECONDS} * interval '1 second')
      FROM claimed
      WHERE outbox.id = claimed.id
      RETURNING
        outbox.id,
        outbox.event_type AS "eventType",
        outbox.ordering_key AS "orderingKey",
        outbox.payload,
        outbox.created_at AS "createdAt"
    `);
  });

  return [...result.rows].sort(compareClaimedRows);
}

export async function markDispatched(source: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const config = _sources.find((s) => s.name === source);
  if (!config) return;

  await config
    .db()
    .update(config.table)
    .set({dispatchedAt: sql`now()`})
    .where(
      and(
        inArray(config.table.id, ids),
        isNull(config.table.dispatchedAt),
        isNull(config.table.deadLetteredAt),
      ),
    );
}

export async function recordDispatchFailure(
  source: string,
  id: string,
  failure: OutboxDispatchFailure,
): Promise<void> {
  const config = _sources.find((s) => s.name === source);
  if (!config) return;

  await config
    .db()
    .update(config.table)
    .set({
      dispatchAttempts: sql`${config.table.dispatchAttempts} + 1`,
      nextDispatchAt: nextDispatchAtSql(config.table),
      lastDispatchError: failure,
      lastDispatchFailedAt: sql`now()`,
      deadLetteredAt: sql`CASE WHEN ${config.table.dispatchAttempts} >= ${
        MAX_DISPATCH_ATTEMPTS - 1
      } THEN now() ELSE ${config.table.deadLetteredAt} END`,
    })
    .where(
      and(
        eq(config.table.id, id),
        isNull(config.table.dispatchedAt),
        isNull(config.table.deadLetteredAt),
      ),
    );
}

export async function pruneDispatchedOutboxRows(
  options: PruneDispatchedOutboxRowsOptions,
): Promise<PrunedOutboxSource[]> {
  assertPositiveInteger(options.retentionDays, 'retentionDays');
  assertPositiveInteger(options.batchSize, 'batchSize');
  assertPositiveInteger(options.maxBatchesPerSource, 'maxBatchesPerSource');

  const results: PrunedOutboxSource[] = [];

  for (const source of _sources) {
    let deleted = 0;
    let capped = false;

    for (let batch = 0; batch < options.maxBatchesPerSource; batch += 1) {
      const batchDeleted = await deleteDispatchedBatch(source, options);
      deleted += batchDeleted;

      if (batchDeleted < options.batchSize) {
        capped = false;
        break;
      }

      capped = batch === options.maxBatchesPerSource - 1;
    }

    results.push({source: source.name, deleted, capped});
  }

  return results;
}

export function resetPublishers(): void {
  _sources.length = 0;
  _schemasByType.clear();
}

async function deleteDispatchedBatch(
  source: PublisherSource,
  options: PruneDispatchedOutboxRowsOptions,
): Promise<number> {
  const result = await source.db().execute<{deleted: number}>(
    sql`
      WITH deleted AS (
        SELECT id
        FROM ${sql.raw(quoteIdentifier(getTableName(source.table)))}
        WHERE dispatched_at < now() - (${options.retentionDays} * interval '1 day')
        ORDER BY dispatched_at, id
        LIMIT ${options.batchSize}
      ),
      removed AS (
        DELETE FROM ${sql.raw(quoteIdentifier(getTableName(source.table)))}
        WHERE id IN (SELECT id FROM deleted)
        RETURNING id
      )
      SELECT count(*)::int AS deleted FROM removed
    `,
  );

  return result.rows[0]?.deleted ?? 0;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function normalizePartition(
  partition: OutboxDispatcherPartition | undefined,
): OutboxDispatcherPartition {
  if (!partition) return {workerIndex: 0, workerCount: 1};
  assertPositiveInteger(partition.workerCount, 'workerCount');

  if (!Number.isInteger(partition.workerIndex) || partition.workerIndex < 0) {
    throw new Error('workerIndex must be a non-negative integer');
  }
  if (partition.workerIndex >= partition.workerCount) {
    throw new Error('workerIndex must be less than workerCount');
  }

  return partition;
}

function partitionPredicateSql(source: PublisherSource, partition: OutboxDispatcherPartition): SQL {
  if (partition.workerCount === 1) return sql`TRUE`;

  return sql`
    mod(
      abs(hashtext(COALESCE(outbox.ordering_key, ${source.name}))::bigint),
      ${partition.workerCount}
    ) = ${partition.workerIndex}
  `;
}

function compareClaimedRows(a: ClaimedOutboxRow, b: ClaimedOutboxRow): number {
  const createdAtDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return createdAtDelta === 0 ? a.id.localeCompare(b.id) : createdAtDelta;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function nextDispatchAtSql(table: OutboxTable) {
  return sql`CASE
    WHEN ${table.dispatchAttempts} = 0 THEN now() + interval '10 seconds'
    WHEN ${table.dispatchAttempts} = 1 THEN now() + interval '1 minute'
    WHEN ${table.dispatchAttempts} = 2 THEN now() + interval '5 minutes'
    WHEN ${table.dispatchAttempts} = 3 THEN now() + interval '30 minutes'
    ELSE now()
  END`;
}
