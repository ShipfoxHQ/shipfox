import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {
  deleteProjectEntryRow,
  listProjectEntries,
  markProjectCachePurged,
  recordProjectCacheDeleted,
} from '#db/project-purge.js';
import {cacheDeletionCount} from '#metrics/instance.js';

const PURGE_BATCH_LIMIT = 100;

/**
 * Blocks later reserves for the project, then deletes every entry: object first, then row, as the
 * sweeper does. A storage failure throws before the row is touched, so a repeat call finishes the
 * job. Returns how many entries it deleted.
 */
export async function purgeProjectCache(params: {
  workspaceId: string;
  projectId: string;
}): Promise<number> {
  await recordProjectCacheDeleted(params);

  let deleted = 0;
  let batch = await listProjectEntries({projectId: params.projectId, limit: PURGE_BATCH_LIMIT});
  while (batch.length > 0) {
    for (const entry of batch) {
      const key = entryObjectKey(entry);
      if (entry.uploadId) await objectStore().abortMultipartUpload({key, uploadId: entry.uploadId});
      await objectStore().deleteObject(key);
      await deleteProjectEntryRow(entry.id);
      cacheDeletionCount.add(1, {reason: 'project_deleted'});
      deleted += 1;
    }
    batch = await listProjectEntries({projectId: params.projectId, limit: PURGE_BATCH_LIMIT});
  }

  await markProjectCachePurged(params);
  return deleted;
}
