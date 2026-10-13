import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {deleteUploadingEntry, findEntryById} from '#db/entries.js';
import {cacheSaveCount} from '#metrics/instance.js';
import type {CacheLease} from './lease.js';

/**
 * Ends the multipart upload first and deletes the row only once storage confirms, so a failed
 * save frees the key and a failed abort leaves the row for the reaper. Repeating it, or aborting
 * an entry that is not an upload of this job execution, does nothing.
 */
export async function abortCacheEntry(params: {lease: CacheLease; entryId: string}): Promise<void> {
  const entry = await findEntryById({id: params.entryId, projectId: params.lease.projectId});
  if (
    entry?.status !== 'uploading' ||
    entry.createdByJobExecutionId !== params.lease.jobExecutionId
  ) {
    return;
  }

  if (entry.uploadId) {
    await objectStore().abortMultipartUpload({
      key: entryObjectKey(entry),
      uploadId: entry.uploadId,
    });
  }
  await deleteUploadingEntry(entry.id);
  cacheSaveCount.add(1, {result: 'aborted'});
}
