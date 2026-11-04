import {
  countProjectWorkflowRuns,
  deleteTerminalWorkflowRuns,
  markProjectPurged,
  recordProjectDeleted,
} from '#db/deleted-scopes.js';
import {stopWork} from './stop-work.js';

/**
 * Blocks later writes for a deleted project, stops its open runs, then deletes its finished runs
 * with their children. A run that is still open stays, and the next pass deletes it. Returns
 * how many runs remain, and marks the project purged once none does.
 */
export async function purgeDeletedProject(params: {
  workspaceId: string;
  projectId: string;
}): Promise<{remaining: number}> {
  const scope = {workspaceId: params.workspaceId, projectId: params.projectId};
  await recordProjectDeleted(scope, 'project_deleted');
  await stopWork({scope, reason: 'project_deleted'});
  await deleteTerminalWorkflowRuns(scope);

  const remaining = await countProjectWorkflowRuns(scope);
  if (remaining === 0) await markProjectPurged(scope);
  return {remaining};
}
