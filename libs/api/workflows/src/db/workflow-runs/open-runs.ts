import {and, asc, count, eq, gt, notInArray} from 'drizzle-orm';
import {db} from '../db.js';
import {workflowRuns} from '../schema/workflow-runs.js';

export interface OpenRunScope {
  workspaceId: string;
  projectId?: string | undefined;
}

function openRunsInScope(scope: OpenRunScope) {
  return and(
    eq(workflowRuns.workspaceId, scope.workspaceId),
    scope.projectId === undefined ? undefined : eq(workflowRuns.projectId, scope.projectId),
    notInArray(workflowRuns.status, ['succeeded', 'failed', 'cancelled']),
  );
}

/** A page of runs in the scope that haven't finished, oldest first, after the `afterId` cursor. */
export async function listOpenWorkflowRunIds(params: {
  scope: OpenRunScope;
  afterId?: string | undefined;
  limit: number;
}): Promise<string[]> {
  const rows = await db()
    .select({id: workflowRuns.id})
    .from(workflowRuns)
    .where(
      and(
        openRunsInScope(params.scope),
        params.afterId === undefined ? undefined : gt(workflowRuns.id, params.afterId),
      ),
    )
    .orderBy(asc(workflowRuns.id))
    .limit(params.limit);
  return rows.map(({id}) => id);
}

export async function countOpenWorkflowRuns(scope: OpenRunScope): Promise<number> {
  const [row] = await db()
    .select({value: count()})
    .from(workflowRuns)
    .where(openRunsInScope(scope));
  return row?.value ?? 0;
}
