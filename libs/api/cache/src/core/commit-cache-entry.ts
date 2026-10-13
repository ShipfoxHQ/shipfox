import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
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
import {evictWorkspace} from './evict-workspace.js';
import {findOwnedEntry} from './find-owned-entry.js';
import type {CacheLease} from './lease.js';
import type {WorkspaceStorageLimits} from './storage-policy.js';

export interface CommitCacheEntryParams {
  lease: CacheLease;
  entryId: string;
  parts: {number: number; etag: string}[];
  limits: WorkspaceStorageLimits;
}

/**
 * Completes the multipart upload, then trusts nothing the runner declared: the stored object must
 * exist and match the reserved size, or the object and the row go. A repeated commit finds the
 * entry ready, or finds the upload already completed and falls through to the same checks. A new
 * entry can push the workspace over its limit, so eviction runs before the answer.
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
    await evictAfterCommit({
      workspaceId: entry.workspaceId,
      entryId: entry.id,
      limits: params.limits,
    });
    return;
  }

  // An abort deleted the row while the upload completed. Another commit may also have won.
  const current = await findEntryById({id: entry.id, projectId: entry.projectId});
  if (current?.status === 'ready') return;
  await objectStore().deleteObject(key);
  throw new UploadAbortedError(entry.id);
}

// The entry is saved either way, and the sweeper evicts on its next pass.
async function evictAfterCommit(params: {
  workspaceId: string;
  entryId: string;
  limits: WorkspaceStorageLimits;
}): Promise<void> {
  try {
    await evictWorkspace({
      workspaceId: params.workspaceId,
      limits: params.limits,
      keepEntryId: params.entryId,
    });
  } catch (error) {
    logger().error({err: error, entryId: params.entryId}, 'Cache eviction after a commit failed');
    reportError(error, {boundary: 'cache.maintenance', extra: {entryId: params.entryId}});
  }
}
