import {CACHE_PART_SIZE_BYTES} from '@shipfox/api-cache-dto';
import {logger} from '@shipfox/node-opentelemetry';
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
import type {WorkspaceStorageLimits} from './storage-policy.js';

export interface ReserveCacheEntryParams {
  lease: CacheLease;
  writeScope: string;
  key: string;
  version: string;
  sizeBytes: number;
  sha256: string;
  limits: WorkspaceStorageLimits;
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
  if (await exceedsSizeLimits(params)) return record({status: 'too_large'});

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
      if (existing.sizeBytes === params.sizeBytes && existing.sha256 === params.sha256) {
        return record(await signedReservation(existing, existing.uploadId));
      }
      // The job re-archived, so the old upload can never match what it will commit.
      await objectStore().abortMultipartUpload({
        key: entryObjectKey(existing),
        uploadId: existing.uploadId,
      });
      await deleteUploadingEntry(existing.id);
      continue;
    }
    return record({status: 'in_progress'});
  }
  return record({status: 'in_progress'});
}

async function exceedsSizeLimits(params: ReserveCacheEntryParams): Promise<boolean> {
  if (params.sizeBytes > config.CACHE_MAX_ENTRY_BYTES) return true;
  // An entry over the whole workspace limit could only be saved by evicting everything else.
  const maxStoredBytes = await params.limits.maxStoredBytes(params.lease.workspaceId);
  return maxStoredBytes !== null && params.sizeBytes > maxStoredBytes;
}

async function startUpload(entry: CacheEntry): Promise<ReserveCacheEntryResult> {
  let uploadId: string | undefined;
  try {
    uploadId = await objectStore().createMultipartUpload({key: entryObjectKey(entry)});
    await setUploadId({id: entry.id, uploadId});
  } catch (error) {
    await releaseFailedStart({entry, uploadId});
    throw error;
  }
  return await signedReservation(entry, uploadId);
}

// Each cleanup step runs on its own, so one failure doesn't leave the other undone. A row that
// survives without an upload id is reaped by the sweeper.
async function releaseFailedStart(params: {
  entry: CacheEntry;
  uploadId: string | undefined;
}): Promise<void> {
  const {entry, uploadId} = params;
  if (uploadId) {
    await objectStore()
      .abortMultipartUpload({key: entryObjectKey(entry), uploadId})
      .catch((error: unknown) => {
        logger().warn({err: error, entryId: entry.id}, 'Failed to abort a cache upload');
      });
  }
  await deleteUploadingEntry(entry.id).catch((error: unknown) => {
    logger().warn({err: error, entryId: entry.id}, 'Failed to delete a cache entry row');
  });
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
