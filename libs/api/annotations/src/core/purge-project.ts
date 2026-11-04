import {
  countProjectAnnotations,
  deleteProjectAnnotations,
  markProjectPurged,
  recordProjectDeleted,
} from '#db/deleted-scopes.js';

/**
 * Blocks later annotation writes for a deleted project, then deletes its annotations. Marks the
 * project purged once none remains.
 */
export async function purgeDeletedProject(scope: {
  workspaceId: string;
  projectId: string;
}): Promise<void> {
  await recordProjectDeleted(scope, 'project_deleted');
  await deleteProjectAnnotations(scope);
  if ((await countProjectAnnotations(scope)) === 0) await markProjectPurged(scope);
}
