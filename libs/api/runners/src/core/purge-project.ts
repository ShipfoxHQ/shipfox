import {logger} from '@shipfox/node-opentelemetry';
import {
  countProjectJobExecutions,
  deleteProjectPendingJobs,
  listUnpurgedProjectScopes,
  markProjectPurged,
  recordProjectDeleted,
} from '#db/deleted-scopes.js';

const UNPURGED_PROJECTS_PER_SWEEP = 100;

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

/**
 * Runs the purge again for every deleted project that never finished it, such as one whose event
 * was dead-lettered while a job was still running. A failure in one project does not stop the
 * others. Returns how many projects it finished.
 */
export async function purgeUnfinishedDeletedProjects(): Promise<{purged: number}> {
  const scopes = await listUnpurgedProjectScopes(UNPURGED_PROJECTS_PER_SWEEP);
  let purged = 0;
  for (const scope of scopes) {
    try {
      const {remaining} = await purgeDeletedProject(scope);
      if (remaining === 0) purged += 1;
    } catch (error) {
      logger().warn({err: error, ...scope}, 'Failed to purge a deleted project');
    }
  }
  return {purged};
}
