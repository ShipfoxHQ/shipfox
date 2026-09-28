import {fileURLToPath} from 'node:url';
import {objectStorageS3Profile, resolveObjectStorageS3Profile} from '@shipfox/node-object-storage';
import {FileRegistryStorage} from '#storage/file.js';
import {S3RegistryStorage} from '#storage/s3.js';
import type {RegistryStorage} from '#storage/storage.js';

export function createRegistryStorage(storageUrl: string): RegistryStorage {
  const url = URL.canParse(storageUrl) ? new URL(storageUrl) : undefined;
  if (url?.protocol === 'file:') return new FileRegistryStorage(fileURLToPath(url));
  if (url?.protocol === 's3:' && url.hostname !== '') {
    return new S3RegistryStorage({
      profile: resolveObjectStorageS3Profile(
        objectStorageS3Profile,
        {bucket: url.hostname},
        'REGISTRY_STORAGE',
      ),
      prefix: url.pathname.replace(/^\/+|\/+$/g, ''),
    });
  }
  throw new Error(
    `REGISTRY_STORAGE_URL must be s3://bucket/prefix or file:///path, got ${JSON.stringify(storageUrl)}`,
  );
}
