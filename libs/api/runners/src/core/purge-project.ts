import {
  countProjectJobExecutions,
  deleteProjectPendingJobs,
  markProjectPurged,
  recordProjectDeleted,
} from '#db/deleted-scopes.js';

/**
 * Blocks later job queueing for a deleted project, then deletes its pending jobs. A running job
 * ends through the cancellation of its run, so it counts as remaining until then. Returns how many
 * jobs remain, and marks the project purged once none does.
 */
export async function purgeDeletedProject(scope: {
  workspaceId: string;
  projectId: string;
}): Promise<{remaining: number}> {
  await recordProjectDeleted(scope, 'project_deleted');
  await deleteProjectPendingJobs(scope);

  const remaining = await countProjectJobExecutions(scope);
  if (remaining === 0) await markProjectPurged(scope);
  return {remaining};
}
