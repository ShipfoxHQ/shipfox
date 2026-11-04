import {getTableName, inArray, type SQL, sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {type AnyPgColumn, type AnyPgTable, text, timestamp, uuid} from 'drizzle-orm/pg-core';

/** A workspace, or one project inside it. */
export interface WorkScope {
  workspaceId: string;
  projectId?: string | undefined;
}

/** A write reached a scope that was deleted. Event consumers skip it, and routes answer not-found. */
export class ScopeDeletedError extends Error {
  constructor(public readonly scope: WorkScope) {
    super(
      scope.projectId === undefined
        ? `Workspace was deleted: ${scope.workspaceId}`
        : `Project was deleted: ${scope.projectId}`,
    );
    this.name = 'ScopeDeletedError';
  }
}

/**
 * The columns of a module's `<module>_deleted_scopes` table. The table must be unique on
 * `(workspace_id, project_id)` with nulls not distinct, so one scope has one marker. A marker
 * with no `project_id` covers the whole workspace.
 */
export function deletedScopeColumns() {
  return {
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id'),
    reason: text('reason').notNull(),
    recordedAt: timestamp('recorded_at', {withTimezone: true}).notNull().defaultNow(),
    purgedAt: timestamp('purged_at', {withTimezone: true}),
  };
}

export type DeletedScopesTable = AnyPgTable & {
  workspaceId: AnyPgColumn;
  projectId: AnyPgColumn;
};

/** A database or transaction. Markers need a transaction, because advisory locks last until it ends. */
export type ScopeTransaction = Pick<NodePgDatabase, 'execute'>;

// The table name is in the key, so two modules never wait on each other's locks.
function scopeLockKey(table: DeletedScopesTable, scope: 'workspace' | 'project', id: string): SQL {
  return sql`hashtextextended(${`${getTableName(table)}:${scope}:${id}`}, 0)`;
}

/**
 * Records that a scope was deleted, once. A repeat call keeps the first marker. It takes an
 * exclusive lock on the scope first, so it waits for every guarded write already in progress, and
 * every guarded write that starts after it commits sees the marker.
 */
export async function recordDeletedScope(
  tx: ScopeTransaction,
  table: DeletedScopesTable,
  params: {scope: WorkScope; reason: string},
): Promise<void> {
  const {scope, reason} = params;
  const lockKey =
    scope.projectId === undefined
      ? scopeLockKey(table, 'workspace', scope.workspaceId)
      : scopeLockKey(table, 'project', scope.projectId);
  await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
  await tx.execute(
    sql`insert into ${table} (workspace_id, project_id, reason)
      values (${scope.workspaceId}, ${scope.projectId ?? null}, ${reason})
      on conflict do nothing`,
  );
}

/**
 * Throws `ScopeDeletedError` when the scope, or its workspace, has a marker. Call it in the
 * transaction of every write to a root row, before the write. It takes shared locks on the
 * workspace and the project, so a marker being recorded waits for this write to commit.
 *
 * The transaction must run at READ COMMITTED. A snapshot taken before the lock wait could miss a
 * marker that committed during it.
 */
export async function assertScopeWritable(
  tx: ScopeTransaction,
  table: DeletedScopesTable,
  scope: WorkScope,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(${scopeLockKey(table, 'workspace', scope.workspaceId)})`,
  );
  if (scope.projectId !== undefined) {
    await tx.execute(
      sql`select pg_advisory_xact_lock_shared(${scopeLockKey(table, 'project', scope.projectId)})`,
    );
  }

  const projectCondition =
    scope.projectId === undefined
      ? sql`project_id is null`
      : sql`(project_id is null or project_id = ${scope.projectId})`;
  const result = await tx.execute(
    sql`select 1 from ${table} where workspace_id = ${scope.workspaceId} and ${projectCondition} limit 1`,
  );
  if (result.rows.length > 0) throw new ScopeDeletedError(scope);
}

export type BatchDeleteDatabase = Pick<NodePgDatabase, 'delete' | 'select'>;

export interface DeleteInBatchesParams {
  db: BatchDeleteDatabase;
  table: AnyPgTable;
  where: SQL | undefined;
  /** Rows per statement. Each statement commits on its own. Defaults to 1,000. */
  batchSize?: number | undefined;
}

const DEFAULT_BATCH_SIZE = 1000;

/**
 * Deletes every row matching `where`, one committed batch at a time, so a large purge holds no
 * long transaction. Batches pick their rows by physical row id, which works for any key. It
 * returns how many rows it deleted.
 */
export async function deleteInBatches(params: DeleteInBatchesParams): Promise<number> {
  const {db, table, where} = params;
  const batchSize = params.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be a positive integer');
  }

  const rowId = sql`ctid`;
  let deleted = 0;
  let finished = false;
  // A concurrent update gives a row a new row id, so a batch can delete nothing while rows remain.
  // The loop therefore ends only when a fresh select finds no match.
  while (!finished) {
    const batch = db.select({rowId}).from(table).where(where).limit(batchSize);
    const result = await db.delete(table).where(inArray(rowId, batch));
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count === 0) {
      const remaining = await db.select({rowId}).from(table).where(where).limit(1);
      finished = remaining.length === 0;
    }
  }
  return deleted;
}
