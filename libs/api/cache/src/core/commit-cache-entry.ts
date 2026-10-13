import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {config} from '#config.js';
import {deleteUploadingEntry, findEntryById, markEntryReady} from '#db/entries.js';
import {cacheSaveCount} from '#metrics/instance.js';
import {
  CacheEntryNotCommittableError,
  EntryTooLargeError,
  InvalidUploadError,
  UploadAbortedError,
  UploadObjectMissingError,
  UploadSizeMismatchError,
} from './errors.js';
import {findOwnedEntry} from './find-owned-entry.js';
import type {CacheLease} from './lease.js';

export interface CommitCacheEntryParams {
  lease: CacheLease;
  entryId: string;
  parts: {number: number; etag: string}[];
}

/**
 * Completes the multipart upload, then trusts nothing the runner declared: the stored object must
 * exist and match the reserved size, or the object and the row go. A repeated commit finds the
 * entry ready, or finds the upload already completed and falls through to the same checks.
 */
export async function commitCacheEntry(params: CommitCacheEntryParams): Promise<void> {
  const entry = await findOwnedEntry(params);
  if (entry.status === 'ready') return;
  if (!entry.uploadId) throw new CacheEntryNotCommittableError(entry.id);

  const key = entryObjectKey(entry);
  const completion = await objectStore().completeMultipartUpload({
    key,
    uploadId: entry.uploadId,
    parts: params.parts,
  });
  // A retried commit finds the upload already completed. The object check decides what to do.
  if (completion.status === 'rejected') {
    cacheSaveCount.add(1, {result: 'invalid_upload'});
    throw new InvalidUploadError(entry.id);
  }

  const stored = await objectStore().head(key);
  if (stored === null) {
    await deleteUploadingEntry(entry.id);
    cacheSaveCount.add(1, {result: 'object_missing'});
    throw new UploadObjectMissingError(entry.id);
  }
  if (stored.contentLength === undefined) {
    throw new Error(`Object store returned no size for cache entry ${entry.id}`);
  }
  if (stored.contentLength !== entry.sizeBytes) {
    await objectStore().deleteObject(key);
    await deleteUploadingEntry(entry.id);
    cacheSaveCount.add(1, {result: 'size_mismatch'});
    throw new UploadSizeMismatchError(entry.id, entry.sizeBytes, stored.contentLength);
  }
  if (entry.sizeBytes > config.CACHE_MAX_ENTRY_BYTES) {
    await objectStore().deleteObject(key);
    await deleteUploadingEntry(entry.id);
    cacheSaveCount.add(1, {result: 'too_large'});
    throw new EntryTooLargeError(entry.id, entry.sizeBytes);
  }

  if (await markEntryReady(entry.id)) {
    cacheSaveCount.add(1, {result: 'committed'});
    return;
  }

  // An abort deleted the row while the upload completed. Another commit may also have won.
  const current = await findEntryById({id: entry.id, projectId: entry.projectId});
  if (current?.status === 'ready') return;
  await objectStore().deleteObject(key);
  throw new UploadAbortedError(entry.id);
}
