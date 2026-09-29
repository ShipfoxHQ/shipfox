import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {REGISTRY_DIGEST_PATTERN} from '@shipfox/registry-format';
import {SOURCE_LIMIT_BYTES} from '#publish/limits.js';
import {type RegistryStorage, StoragePreconditionFailedError} from '#storage/storage.js';

export const BLOB_CONTENT_TYPE = 'application/gzip';
export const BLOB_CONTENT_DISPOSITION = 'attachment';
export const BLOB_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export class BlobDigestMismatchError extends Error {
  override name = 'BlobDigestMismatchError';

  constructor(digest: string) {
    super(`The gzip data does not hold content with digest ${digest}`);
  }
}

export class BlobConflictError extends Error {
  override name = 'BlobConflictError';

  constructor(digest: string) {
    super(`The store already holds different content at the key of ${digest}`);
  }
}

/** The bucket key of a `sha256:<hex>` digest. */
export function blobKey(digest: string): string {
  if (!REGISTRY_DIGEST_PATTERN.test(digest)) {
    throw new TypeError(`${JSON.stringify(digest)} is not a sha256 digest`);
  }
  return `blobs/sha256/${digest.slice('sha256:'.length)}`;
}

/**
 * The digest of a bundle covers its canonical JSON, not the gzip that stores it, so two gzip
 * encodings of one bundle share a digest. Undefined when `gzip` is not gzip data or inflates past
 * the largest bundle the registry accepts.
 */
function contentDigest(gzip: Buffer): string | undefined {
  try {
    const bytes = gunzipSync(gzip, {maxOutputLength: SOURCE_LIMIT_BYTES});
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  } catch {
    return undefined;
  }
}

export interface BlobStore {
  put(params: {digest: string; body: Buffer}): Promise<void>;
}

/**
 * Content bundles and source archives as gzip, keyed by the digest of their content. Blobs are
 * written create-only, so an existing key is never overwritten. Versions with identical content
 * share one blob.
 */
export function createBlobStore(storage: RegistryStorage): BlobStore {
  return {
    async put({digest, body}) {
      const key = blobKey(digest);
      if (contentDigest(body) !== digest) throw new BlobDigestMismatchError(digest);
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
        // The same content already stored is a retry, even when another gzip encoding wrote it.
        // Anything else means the store is wrong.
        const existing = await storage.get(key);
        if (existing === null || contentDigest(existing.body) !== digest) {
          throw new BlobConflictError(digest);
        }
      }
    },
  };
}
