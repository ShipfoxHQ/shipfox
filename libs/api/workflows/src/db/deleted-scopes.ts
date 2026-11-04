import {
  assertScopeWritable,
  deleteInBatches,
  recordDeletedScope,
  ScopeDeletedError,
  type WorkScope,
} from '@shipfox/node-drizzle';
import {and, count, eq, inArray, isNull, sql} from 'drizzle-orm';
import {ProjectDeletedError} from '#core/errors.js';
import {db, type Tx} from './db.js';
import {workflowsDeletedScopes} from './schema/deleted-scopes.js';
import {workflowRuns} from './schema/workflow-runs.js';

export interface DeletedProjectScope {
  workspaceId: string;
  projectId: string;
}

/** Refuses a write to a root row of a deleted project. Call it first in the write's transaction. */
export function assertProjectWritable(tx: Tx, scope: DeletedProjectScope): Promise<void> {
  return assertScopeWritable(tx, workflowsDeletedScopes, scope);
}

/**
 * Turns the refusal of a guarded write into the error every run start path already handles, so a
 * trigger or a rerun for a deleted project is dropped, not retried.
 */
export function rethrowDeletedProject(projectId: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof ScopeDeletedError) throw new ProjectDeletedError(projectId);
    throw error;
  };
}

export async function recordProjectDeleted(
  scope: DeletedProjectScope,
  reason: string,
): Promise<void> {
  await db().transaction((tx) =>
    recordDeletedScope(tx, workflowsDeletedScopes, {scope: toWorkScope(scope), reason}),
  );
}

/** Deletes the project's finished runs. Their attempts, jobs, steps, and claims cascade. */
export function deleteTerminalWorkflowRuns(scope: DeletedProjectScope): Promise<number> {
  return deleteInBatches({
    db: db(),
    table: workflowRuns,
    where: and(
      eq(workflowRuns.workspaceId, scope.workspaceId),
      eq(workflowRuns.projectId, scope.projectId),
      inArray(workflowRuns.status, ['succeeded', 'failed', 'cancelled']),
    ),
  });
}

export async function countProjectWorkflowRuns(scope: DeletedProjectScope): Promise<number> {
  const [row] = await db()
    .select({value: count()})
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workspaceId, scope.workspaceId),
        eq(workflowRuns.projectId, scope.projectId),
      ),
    );
  return row?.value ?? 0;
}

export async function markProjectPurged(scope: DeletedProjectScope): Promise<void> {
  await db()
    .update(workflowsDeletedScopes)
    .set({purgedAt: sql`now()`})
    .where(
      and(
        eq(workflowsDeletedScopes.workspaceId, scope.workspaceId),
        eq(workflowsDeletedScopes.projectId, scope.projectId),
        isNull(workflowsDeletedScopes.purgedAt),
      ),
    );
}

function toWorkScope(scope: DeletedProjectScope): WorkScope {
  return {workspaceId: scope.workspaceId, projectId: scope.projectId};
}
