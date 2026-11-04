import {logger} from '@shipfox/node-opentelemetry';
import {
  cancelWorkflowRun,
  countOpenWorkflowRuns,
  listOpenWorkflowRunIds,
} from '#db/workflow-runs.js';
import {WorkflowRunNotCancellableError, WorkflowRunNotFoundError} from './errors.js';

export type StopWorkReason = 'project_deleted' | 'workspace_suspended' | 'limit_reached';

export interface StopWorkScope {
  workspaceId: string;
  projectId?: string | undefined;
}

const STOP_WORK_PAGE_SIZE = 100;

/**
 * Cancels every run in the scope that hasn't finished, listening jobs included, through the same
 * path as a user's cancel. A run that finishes first is already stopped. `remaining` counts the
 * runs still open, so a caller repeats the call until it reads 0, and a repeat finds nothing to do.
 */
export async function stopWork(params: {
  scope: StopWorkScope;
  reason: StopWorkReason;
}): Promise<{remaining: number}> {
  const {scope, reason} = params;
  let afterId: string | undefined;
  let runIds: string[];
  do {
    runIds = await listOpenWorkflowRunIds({scope, afterId, limit: STOP_WORK_PAGE_SIZE});
    for (const workflowRunId of runIds) {
      try {
        await cancelWorkflowRun({workflowRunId});
      } catch (error) {
        if (
          error instanceof WorkflowRunNotCancellableError ||
          error instanceof WorkflowRunNotFoundError
        ) {
          continue;
        }
        // The run stays open and counts as remaining, so the caller's next pass retries it.
        logger().error({err: error, workflowRunId, reason}, 'Failed to stop a workflow run');
      }
    }
    afterId = runIds.at(-1);
  } while (runIds.length === STOP_WORK_PAGE_SIZE);
  return {remaining: await countOpenWorkflowRuns(scope)};
}
