import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {config} from '#config.js';
import {deleteUploadingEntry, markEntryReady} from '#db/entries.js';
import {cacheSaveCount} from '#metrics/instance.js';
import type {CacheEntry} from './entities/cache-entry.js';
import {
  CacheEntryNotCommittableError,
  InvalidUploadError,
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
  await completeUpload({entry, uploadId: entry.uploadId, parts: params.parts});

  const stored = await objectStore().head(key);
  if (stored === null) {
    await deleteUploadingEntry(entry.id);
    cacheSaveCount.add(1, {result: 'object_missing'});
    throw new UploadObjectMissingError(entry.id);
  }
  if (stored.contentLength !== entry.sizeBytes || entry.sizeBytes > config.CACHE_MAX_ENTRY_BYTES) {
    await objectStore().deleteObject(key);
    await deleteUploadingEntry(entry.id);
    cacheSaveCount.add(1, {result: 'size_mismatch'});
    throw new UploadSizeMismatchError(entry.id, entry.sizeBytes, stored.contentLength);
  }

  const ready = await markEntryReady(entry.id);
  if (ready) cacheSaveCount.add(1, {result: 'committed'});
}

async function completeUpload(params: {
  entry: CacheEntry;
  uploadId: string;
  parts: CommitCacheEntryParams['parts'];
}): Promise<void> {
  try {
    await objectStore().completeMultipartUpload({
      key: entryObjectKey(params.entry),
      uploadId: params.uploadId,
      parts: params.parts,
    });
  } catch (error) {
    // A retried commit finds the upload already completed. The object check decides what to do.
    if (errorName(error) === 'NoSuchUpload') return;
    if (isClientRejection(error)) {
      cacheSaveCount.add(1, {result: 'invalid_upload'});
      throw new InvalidUploadError(params.entry.id);
    }
    throw error;
  }
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as {name?: string}).name : undefined;
}

function isClientRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as {$metadata?: {httpStatusCode?: number}}).$metadata?.httpStatusCode;
  return status !== undefined && status >= 400 && status < 500;
}
