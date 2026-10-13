import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {deleteReadyEntry, deleteUploadingEntry} from '#db/entries.js';
import {cacheDeletionCount} from '#metrics/instance.js';
import type {CacheDeletionReason, CacheEntry} from './entities/cache-entry.js';

/**
 * Object first, then the row. A storage failure throws before the row is touched, so the entry
 * stays listed for the next pass. A crash in between leaves a row without an object, which the
 * lookup checks remove. Returns whether this call deleted the row.
 */
export async function deleteEntry(params: {
  entry: CacheEntry;
  reason: CacheDeletionReason;
}): Promise<boolean> {
  await objectStore().deleteObject(entryObjectKey(params.entry));
  return await deleteReadyEntry(params);
}

/**
 * Ends the multipart upload, then deletes the object in case the upload completed and the row was
 * never marked ready. The row goes only once storage confirmed both.
 */
export async function deleteStaleUpload(entry: CacheEntry): Promise<boolean> {
  const key = entryObjectKey(entry);
  if (entry.uploadId) await objectStore().abortMultipartUpload({key, uploadId: entry.uploadId});
  await objectStore().deleteObject(key);
  const deleted = await deleteUploadingEntry(entry.id);
  if (deleted) cacheDeletionCount.add(1, {reason: 'stale_upload'});
  return deleted;
}
