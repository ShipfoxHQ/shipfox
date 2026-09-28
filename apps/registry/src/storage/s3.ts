import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {ObjectStorageS3Profile} from '@shipfox/node-object-storage';
import {
  assertStorageKey,
  type PutObjectParams,
  type RegistryStorage,
  StoragePreconditionFailedError,
  type StoredObject,
} from '#storage/storage.js';

/** Stores registry files in an S3-compatible bucket (S3, R2, MinIO), under an optional prefix. */
export class S3RegistryStorage implements RegistryStorage {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #prefix: string;

  constructor({profile, prefix}: {profile: ObjectStorageS3Profile; prefix: string}) {
    this.#bucket = profile.bucket;
    this.#prefix = prefix === '' ? '' : `${prefix}/`;
    this.#client = new S3Client({
      endpoint: profile.endpoint,
      region: profile.region,
      forcePathStyle: profile.forcePathStyle,
      ...(profile.credentials ? {credentials: profile.credentials} : {}),
      maxAttempts: 3,
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({Bucket: this.#bucket, Key: this.#key(key)}),
      );
      const body = Buffer.from((await response.Body?.transformToByteArray()) ?? []);
      return {body, etag: response.ETag ?? ''};
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async put({key, body, contentType, ifNoneMatch, ifMatch}: PutObjectParams) {
    try {
      const response = await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: this.#key(key),
          Body: body,
          ContentType: contentType,
          IfNoneMatch: ifNoneMatch,
          IfMatch: ifMatch,
        }),
      );
      return {etag: response.ETag ?? ''};
    } catch (error) {
      // 409 is S3's answer when a concurrent conditional write to the same key wins.
      const status = statusOf(error);
      if (status === 412 || status === 409) throw new StoragePreconditionFailedError(key);
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const listed = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: `${this.#prefix}${prefix}`,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of listed.Contents ?? []) {
        if (object.Key) keys.push(object.Key.slice(this.#prefix.length));
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys.sort();
  }

  close(): void {
    this.#client.destroy();
  }

  #key(key: string): string {
    return `${this.#prefix}${assertStorageKey(key)}`;
  }
}

function statusOf(error: unknown): number | undefined {
  return (error as {$metadata?: {httpStatusCode?: number}} | undefined)?.$metadata?.httpStatusCode;
}
