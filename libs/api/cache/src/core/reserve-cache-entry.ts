import {CACHE_PART_SIZE_BYTES} from '@shipfox/api-cache-dto';
import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {config} from '#config.js';
import {
  deleteUploadingEntry,
  findEntryByIdentity,
  insertUploadingEntry,
  setUploadId,
  touchEntry,
} from '#db/entries.js';
import {cacheSaveCount} from '#metrics/instance.js';
import type {CacheEntry} from './entities/cache-entry.js';
import type {CacheLease} from './lease.js';

export interface ReserveCacheEntryParams {
  lease: CacheLease;
  writeScope: string;
  key: string;
  version: string;
  sizeBytes: number;
  sha256: string;
}

export type ReserveCacheEntryResult =
  | {status: 'reserved'; entryId: string; partSize: number; partUrls: string[]}
  | {status: 'exists' | 'in_progress' | 'too_large'};

// A winner can delete its row (a failed multipart start) between our insert and our read.
const MAX_ATTEMPTS = 3;

/**
 * The unique index decides concurrent reserves: the loser skips its upload. The job execution
 * that holds an `uploading` row gets it back with fresh URLs, so a retried reserve is safe.
 */
export async function reserveCacheEntry(
  params: ReserveCacheEntryParams,
): Promise<ReserveCacheEntryResult> {
  if (params.sizeBytes > config.CACHE_MAX_ENTRY_BYTES) {
    return record({status: 'too_large'});
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const inserted = await insertUploadingEntry({
      workspaceId: params.lease.workspaceId,
      projectId: params.lease.projectId,
      scope: params.writeScope,
      key: params.key,
      version: params.version,
      sizeBytes: params.sizeBytes,
      sha256: params.sha256,
      createdByRunId: params.lease.workflowRunId,
      createdByJobExecutionId: params.lease.jobExecutionId,
    });
    if (inserted) return record(await startUpload(inserted));

    const existing = await findEntryByIdentity({
      projectId: params.lease.projectId,
      scope: params.writeScope,
      key: params.key,
      version: params.version,
    });
    if (!existing) continue;

    if (existing.status === 'ready') {
      await touchEntry(existing.id);
      return record({status: 'exists'});
    }
    if (existing.createdByJobExecutionId === params.lease.jobExecutionId && existing.uploadId) {
      return record(await signedReservation(existing, existing.uploadId));
    }
    return record({status: 'in_progress'});
  }
  return record({status: 'in_progress'});
}

async function startUpload(entry: CacheEntry): Promise<ReserveCacheEntryResult> {
  let uploadId: string;
  try {
    uploadId = await objectStore().createMultipartUpload({key: entryObjectKey(entry)});
    await setUploadId({id: entry.id, uploadId});
  } catch (error) {
    await deleteUploadingEntry(entry.id);
    throw error;
  }
  return await signedReservation(entry, uploadId);
}

async function signedReservation(
  entry: CacheEntry,
  uploadId: string,
): Promise<ReserveCacheEntryResult> {
  const key = entryObjectKey(entry);
  const partCount = Math.ceil(entry.sizeBytes / CACHE_PART_SIZE_BYTES);
  const parts = await Promise.all(
    Array.from({length: partCount}, (_, index) =>
      objectStore().presignUploadPart({
        key,
        uploadId,
        partNumber: index + 1,
        expiresInSeconds: config.CACHE_URL_TTL_SECONDS,
      }),
    ),
  );
  return {
    status: 'reserved',
    entryId: entry.id,
    partSize: CACHE_PART_SIZE_BYTES,
    partUrls: parts.map((part) => part.url),
  };
}

function record(result: ReserveCacheEntryResult): ReserveCacheEntryResult {
  cacheSaveCount.add(1, {result: result.status});
  return result;
}
