import {
  createS3ObjectStore,
  objectStorageS3Profile,
  resolveObjectStorageS3Profile,
  type S3ObjectStore,
} from '@shipfox/node-object-storage';
import {config} from '#config.js';
import type {CacheEntry} from '#core/entities/cache-entry.js';
import {cacheObjectKey} from '#core/object-key.js';

// Completing a few hundred parts can outlast the 3 s control timeout.
const COMPLETE_UPLOAD_TIMEOUT_MS = 60_000;

let _store: S3ObjectStore | undefined;

export function objectStore(): S3ObjectStore {
  if (!_store) {
    _store = createS3ObjectStore({
      profile: resolveObjectStorageS3Profile(
        objectStorageS3Profile,
        {
          endpoint: config.CACHE_STORAGE_S3_ENDPOINT,
          region: config.CACHE_STORAGE_S3_REGION,
          bucket: config.CACHE_STORAGE_S3_BUCKET,
          accessKeyId: config.CACHE_STORAGE_S3_ACCESS_KEY_ID,
          secretAccessKey: config.CACHE_STORAGE_S3_SECRET_ACCESS_KEY,
          forcePathStyle: config.CACHE_STORAGE_S3_FORCE_PATH_STYLE,
        },
        'CACHE_STORAGE_S3',
      ),
      prefix: config.CACHE_STORAGE_S3_PREFIX,
      transferRequestTimeoutMs: COMPLETE_UPLOAD_TIMEOUT_MS,
      publicEndpoint: config.CACHE_STORAGE_PUBLIC_ENDPOINT,
    });
  }
  return _store;
}

export function closeS3Client(): void {
  _store?.close();
  _store = undefined;
}

export function checkBucketReachable(): Promise<boolean> {
  return objectStore().checkReachable();
}

export function entryObjectKey(
  entry: Pick<CacheEntry, 'id' | 'workspaceId' | 'projectId'>,
): string {
  return cacheObjectKey({
    prefix: config.CACHE_STORAGE_S3_PREFIX,
    workspaceId: entry.workspaceId,
    projectId: entry.projectId,
    entryId: entry.id,
  });
}
