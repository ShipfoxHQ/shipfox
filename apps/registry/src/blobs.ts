import {createHash} from 'node:crypto';
import {REGISTRY_DIGEST_PATTERN} from '@shipfox/registry-format';
import {type RegistryStorage, StoragePreconditionFailedError} from '#storage/storage.js';

export const BLOB_CONTENT_TYPE = 'application/gzip';
export const BLOB_CONTENT_DISPOSITION = 'attachment';
export const BLOB_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export class BlobDigestMismatchError extends Error {
  override name = 'BlobDigestMismatchError';

  constructor(digest: string) {
    super(`The bytes do not match ${digest}`);
  }
}

export class BlobConflictError extends Error {
  override name = 'BlobConflictError';

  constructor(digest: string) {
    super(`The store already holds different bytes at the key of ${digest}`);
  }
}

/** The bucket key of a `sha256:<hex>` digest. */
export function blobKey(digest: string): string {
  if (!REGISTRY_DIGEST_PATTERN.test(digest)) {
    throw new TypeError(`${JSON.stringify(digest)} is not a sha256 digest`);
  }
  return `blobs/sha256/${digest.slice('sha256:'.length)}`;
}

export interface BlobStore {
  put(params: {digest: string; body: Buffer}): Promise<void>;
}

/**
 * Content bundles and source archives, keyed by digest. Blobs are written create-only, so an
 * existing key already holds the same bytes and is never overwritten. Versions with identical
 * bytes share one blob.
 */
export function createBlobStore(storage: RegistryStorage): BlobStore {
  return {
    async put({digest, body}) {
      const key = blobKey(digest);
      if (`sha256:${createHash('sha256').update(body).digest('hex')}` !== digest) {
        throw new BlobDigestMismatchError(digest);
      }
      try {
        await storage.put({
          key,
          body,
          contentType: BLOB_CONTENT_TYPE,
          contentDisposition: BLOB_CONTENT_DISPOSITION,
          cacheControl: BLOB_CACHE_CONTROL,
          ifNoneMatch: '*',
        });
      } catch (error) {
        if (!(error instanceof StoragePreconditionFailedError)) throw error;
        // A concurrent publish of the same bytes is a retry. Anything else means the store is wrong.
        const existing = await storage.get(key);
        if (!existing?.body.equals(body)) throw new BlobConflictError(digest);
      }
    },
  };
}
