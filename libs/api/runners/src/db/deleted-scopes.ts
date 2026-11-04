import {deleteInBatches, recordDeletedScope} from '@shipfox/node-drizzle';
import {and, asc, count, eq, isNotNull, isNull, sql} from 'drizzle-orm';
import {db} from './db.js';
import {runnersDeletedScopes} from './schema/deleted-scopes.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export interface DeletedProjectScope {
  workspaceId: string;
  projectId: string;
}

export async function recordProjectDeleted(
  scope: DeletedProjectScope,
  reason: string,
): Promise<void> {
  await db().transaction((tx) => recordDeletedScope(tx, runnersDeletedScopes, {scope, reason}));
}

/** Deleted projects whose purge has not finished, oldest first. */
export async function listUnpurgedProjectScopes(limit: number): Promise<DeletedProjectScope[]> {
  const rows = await db()
    .select({
      workspaceId: runnersDeletedScopes.workspaceId,
      projectId: runnersDeletedScopes.projectId,
    })
    .from(runnersDeletedScopes)
    .where(and(isNull(runnersDeletedScopes.purgedAt), isNotNull(runnersDeletedScopes.projectId)))
    .orderBy(asc(runnersDeletedScopes.recordedAt))
    .limit(limit);
  return rows.flatMap((row) =>
    row.projectId === null ? [] : [{workspaceId: row.workspaceId, projectId: row.projectId}],
  );
}

export function deleteProjectPendingJobs(scope: DeletedProjectScope): Promise<number> {
  return deleteInBatches({
    db: db(),
    table: pendingJobExecutions,
    where: and(
      eq(pendingJobExecutions.workspaceId, scope.workspaceId),
      eq(pendingJobExecutions.projectId, scope.projectId),
    ),
  });
}

/** Pending and running jobs of the project. A running job ends through its run's cancellation. */
export async function countProjectJobExecutions(scope: DeletedProjectScope): Promise<number> {
  const [pending] = await db()
    .select({value: count()})
    .from(pendingJobExecutions)
    .where(
      and(
        eq(pendingJobExecutions.workspaceId, scope.workspaceId),
        eq(pendingJobExecutions.projectId, scope.projectId),
      ),
    );
  const [running] = await db()
    .select({value: count()})
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.workspaceId, scope.workspaceId),
        eq(runningJobExecutions.projectId, scope.projectId),
      ),
    );
  return (pending?.value ?? 0) + (running?.value ?? 0);
}

export async function markProjectPurged(scope: DeletedProjectScope): Promise<void> {
  await db()
    .update(runnersDeletedScopes)
    .set({purgedAt: sql`now()`})
    .where(
      and(
        eq(runnersDeletedScopes.workspaceId, scope.workspaceId),
        eq(runnersDeletedScopes.projectId, scope.projectId),
        isNull(runnersDeletedScopes.purgedAt),
      ),
    );
}
