import {deleteObjectsByPrefix} from '#api/object-storage.js';
import {config} from '#config.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {
  deleteStreamsWithAccounting,
  listProjectStreams,
  markProjectPurged,
  projectHasStreams,
  recordProjectDeleted,
} from '#db/deleted-scopes.js';

const PURGE_BATCH_SIZE = 100;

/**
 * Blocks later writes for a deleted project, then deletes its log streams with their chunks and
 * stored objects. Objects go before rows, so a failed cleanup leaves the row for the next pass.
 * Marks the project purged once no stream remains.
 */
export async function purgeDeletedProject(scope: {
  workspaceId: string;
  projectId: string;
}): Promise<void> {
  await recordProjectDeleted(scope, 'project_deleted');

  let streams = await listProjectStreams(scope, PURGE_BATCH_SIZE);
  while (streams.length > 0) {
    for (const stream of streams) {
      await deleteObjectsByPrefix(`${logObjectKey(config.LOG_STORAGE_S3_PREFIX, stream)}/`);
    }
    await deleteStreamsWithAccounting(streams);
    streams = await listProjectStreams(scope, PURGE_BATCH_SIZE);
  }

  if (!(await projectHasStreams(scope))) await markProjectPurged(scope);
}
