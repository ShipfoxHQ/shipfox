import type {DomainEvent, OutboxTable} from '@shipfox/node-outbox';
import {and, asc, eq, getTableName, inArray, isNull, lte, sql} from 'drizzle-orm';
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

export async function drainAll(): Promise<DrainAllResult> {
  const results: DrainedEvent[] = [];
  let hasMore = false;

  for (const source of _sources) {
    const rows = await source
      .db()
      .select()
      .from(source.table)
      .where(
        and(
          isNull(source.table.dispatchedAt),
          isNull(source.table.deadLetteredAt),
          lte(source.table.nextDispatchAt, sql`now()`),
        ),
      )
      .orderBy(asc(source.table.nextDispatchAt), asc(source.table.createdAt))
      .limit(BATCH_SIZE);
    if (rows.length === BATCH_SIZE) hasMore = true;

    for (const row of rows) {
      results.push({
        source: source.name,
        orderingKey: row.orderingKey ?? source.name,
        id: row.id,
        event: {
          id: row.id,
          type: row.eventType,
          payload: row.payload,
          createdAt: row.createdAt,
        },
      });
    }
  }

  return {events: results, hasMore};
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
