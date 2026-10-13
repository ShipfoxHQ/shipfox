import {Readable} from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {createObjectStorageS3Clients, type ObjectStorageS3Clients} from './client.js';
import type {ObjectStorageS3Profile} from './config.js';
import {
  ObjectStorageDeleteError,
  ObjectStorageScopeError,
  ObjectStorageUploadAbortedError,
} from './errors.js';

export interface CreateS3ObjectStoreOptions {
  readonly profile: ObjectStorageS3Profile;
  readonly prefix: string;
  /** Maximum duration of one data-transfer request. Zero leaves it unbounded. */
  readonly transferRequestTimeoutMs?: number | undefined;
  /**
   * Endpoint written into presigned URLs when callers reach the store by another name than this
   * process does. The host is part of the signature, so it must be chosen at signing time.
   */
  readonly publicEndpoint?: string | undefined;
}

export interface CreateMultipartUploadParams {
  readonly key: string;
  readonly contentType?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
}

export interface PresignUploadPartParams {
  readonly key: string;
  readonly uploadId: string;
  /** 1-based, at most 10000. */
  readonly partNumber: number;
  readonly expiresInSeconds: number;
}

export interface CompletedUploadPart {
  readonly number: number;
  readonly etag: string;
}

export interface CompleteMultipartUploadParams {
  readonly key: string;
  readonly uploadId: string;
  readonly parts: readonly CompletedUploadPart[];
}

export type CompleteMultipartUploadResult =
  | {readonly status: 'completed'}
  /** The upload id is gone: aborted, expired, or already completed by an earlier call. */
  | {readonly status: 'upload-not-found'}
  /** The store refused the parts: a wrong ETag, a wrong order, or a part that is too small. */
  | {readonly status: 'rejected'; readonly code: string};

export interface AbortMultipartUploadParams {
  readonly key: string;
  readonly uploadId: string;
}

export interface PutObjectBytesParams {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
}

export interface PutMultipartObjectParams {
  readonly key: string;
  readonly body: Readable;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
  readonly partSize: number;
  readonly concurrency: number;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: (() => void) | undefined;
  readonly onAbortError?: ((error: unknown) => void) | undefined;
}

export interface StoredObjectBytes {
  readonly body: Buffer;
  readonly metadata: Record<string, string>;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
}

export interface StoredObjectStream {
  readonly body: Readable;
  readonly metadata: Record<string, string>;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
}

export interface StoredObjectHead {
  readonly metadata: Record<string, string>;
  readonly contentType?: string | undefined;
  readonly contentEncoding?: string | undefined;
  readonly contentLength?: number | undefined;
}

export interface PresignedObjectGet {
  readonly url: string;
  readonly expiresAt: Date;
}

const REJECTED_PARTS_CODES = new Set([
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
  'MalformedXML',
]);

export class S3ObjectStore {
  readonly #bucket: string;
  readonly #prefix: string;
  readonly #clients: ObjectStorageS3Clients;

  constructor({
    profile,
    prefix,
    transferRequestTimeoutMs,
    publicEndpoint,
  }: CreateS3ObjectStoreOptions) {
    assertObjectStoragePrefix(prefix);
    this.#bucket = profile.bucket;
    this.#prefix = prefix;
    this.#clients = createObjectStorageS3Clients(profile, {
      transferRequestTimeoutMs,
      publicEndpoint,
    });
  }

  async checkReachable(): Promise<boolean> {
    try {
      await this.#clients.control.send(new HeadBucketCommand({Bucket: this.#bucket}));
      return true;
    } catch {
      return false;
    }
  }

  async putBytes(params: PutObjectBytesParams): Promise<void> {
    this.#assertInScope(params.key);
    await this.#clients.transfer.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ContentEncoding: params.contentEncoding,
        Metadata: params.metadata,
      }),
    );
  }

  async putMultipart(params: PutMultipartObjectParams): Promise<void> {
    this.#assertInScope(params.key);
    const upload = new Upload({
      client: this.#clients.transfer,
      partSize: params.partSize,
      queueSize: params.concurrency,
      params: {
        Bucket: this.#bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ContentEncoding: params.contentEncoding,
        Metadata: params.metadata,
      },
    });

    if (params.onProgress) upload.on('httpUploadProgress', params.onProgress);
    const abortUpload = () =>
      upload.abort().catch((error: unknown) => {
        params.onAbortError?.(error);
      });
    const handleAbort = () => {
      void abortUpload();
    };
    if (params.signal) params.signal.addEventListener('abort', handleAbort, {once: true});

    try {
      if (params.signal?.aborted) {
        await abortUpload();
        throw new ObjectStorageUploadAbortedError();
      }
      await upload.done();
    } finally {
      params.signal?.removeEventListener('abort', handleAbort);
    }
  }

  async getBytes(key: string): Promise<StoredObjectBytes | null> {
    this.#assertInScope(key);
    try {
      const response = await this.#clients.transfer.send(
        new GetObjectCommand({Bucket: this.#bucket, Key: key}),
      );
      const body = response.Body
        ? Buffer.from(await response.Body.transformToByteArray())
        : Buffer.alloc(0);
      return {
        body,
        metadata: response.Metadata ?? {},
        contentType: response.ContentType,
        contentEncoding: response.ContentEncoding,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async getStream(key: string): Promise<StoredObjectStream | null> {
    this.#assertInScope(key);
    try {
      const response = await this.#clients.transfer.send(
        new GetObjectCommand({Bucket: this.#bucket, Key: key}),
      );
      return {
        // The Node S3 client returns a Node Readable. Keep the cast at this adapter boundary so
        // callers can consume large objects incrementally without materializing the body.
        body: response.Body ? (response.Body as unknown as Readable) : Readable.from([]),
        metadata: response.Metadata ?? {},
        contentType: response.ContentType,
        contentEncoding: response.ContentEncoding,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async head(key: string): Promise<StoredObjectHead | null> {
    this.#assertInScope(key);
    try {
      const response = await this.#clients.control.send(
        new HeadObjectCommand({Bucket: this.#bucket, Key: key}),
      );
      return {
        metadata: response.Metadata ?? {},
        contentType: response.ContentType,
        contentEncoding: response.ContentEncoding,
        contentLength: response.ContentLength,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    this.#assertInScope(prefix);
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const listed = await this.#clients.control.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of listed.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  async deleteObject(key: string): Promise<void> {
    this.#assertInScope(key);
    await this.#clients.control.send(new DeleteObjectCommand({Bucket: this.#bucket, Key: key}));
  }

  async deleteObjects(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.#assertInScope(key);
    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000).map((Key) => ({Key}));
      if (batch.length === 0) continue;
      const deleted = await this.#clients.control.send(
        new DeleteObjectsCommand({
          Bucket: this.#bucket,
          Delete: {Objects: batch, Quiet: true},
        }),
      );
      if (deleted.Errors && deleted.Errors.length > 0) {
        throw new ObjectStorageDeleteError(
          deleted.Errors.map((failure) => ({
            key: failure.Key,
            code: failure.Code,
            message: failure.Message,
          })),
        );
      }
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    this.#assertInScope(prefix);
    let continuationToken: string | undefined;
    do {
      const listed = await this.#clients.control.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      await this.deleteObjects(
        (listed.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])),
      );
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<PresignedObjectGet> {
    this.#assertInScope(key);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const url = await getSignedUrl(
      this.#clients.presign,
      new GetObjectCommand({Bucket: this.#bucket, Key: key}),
      {expiresIn: expiresInSeconds},
    );
    return {url, expiresAt};
  }

  async createMultipartUpload(params: CreateMultipartUploadParams): Promise<string> {
    this.#assertInScope(params.key);
    const created = await this.#clients.control.send(
      new CreateMultipartUploadCommand({
        Bucket: this.#bucket,
        Key: params.key,
        ContentType: params.contentType,
        Metadata: params.metadata,
      }),
    );
    if (!created.UploadId) throw new Error('Object store returned no multipart upload id.');
    return created.UploadId;
  }

  async presignUploadPart(params: PresignUploadPartParams): Promise<PresignedObjectGet> {
    this.#assertInScope(params.key);
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);
    const url = await getSignedUrl(
      this.#clients.presign,
      new UploadPartCommand({
        Bucket: this.#bucket,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumber: params.partNumber,
      }),
      {expiresIn: params.expiresInSeconds},
    );
    return {url, expiresAt};
  }

  /**
   * Completing a few hundred parts can outlast the control timeout, so this uses the transfer
   * client. Set `transferRequestTimeoutMs` on the store to bound it. The outcomes the caller
   * can act on are results; any other failure, such as a denied or timed-out request, throws.
   */
  async completeMultipartUpload(
    params: CompleteMultipartUploadParams,
  ): Promise<CompleteMultipartUploadResult> {
    this.#assertInScope(params.key);
    const parts = [...params.parts]
      .sort((left, right) => left.number - right.number)
      .map((part) => ({PartNumber: part.number, ETag: part.etag}));
    try {
      await this.#clients.transfer.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.#bucket,
          Key: params.key,
          UploadId: params.uploadId,
          MultipartUpload: {Parts: parts},
        }),
      );
      return {status: 'completed'};
    } catch (error) {
      const code = errorName(error);
      if (code === 'NoSuchUpload') return {status: 'upload-not-found'};
      if (code && REJECTED_PARTS_CODES.has(code)) return {status: 'rejected', code};
      throw error;
    }
  }

  /** Resolves when the upload is gone, including when it never existed or already completed. */
  async abortMultipartUpload(params: AbortMultipartUploadParams): Promise<void> {
    this.#assertInScope(params.key);
    try {
      await this.#clients.control.send(
        new AbortMultipartUploadCommand({
          Bucket: this.#bucket,
          Key: params.key,
          UploadId: params.uploadId,
        }),
      );
    } catch (error) {
      if (errorName(error) === 'NoSuchUpload') return;
      throw error;
    }
  }

  close(): void {
    this.#clients.control.destroy();
    this.#clients.transfer.destroy();
    this.#clients.presign.destroy();
  }

  #assertInScope(key: string): void {
    if (key !== this.#prefix && !key.startsWith(`${this.#prefix}/`)) {
      throw new ObjectStorageScopeError(key, this.#prefix);
    }
  }
}

export function createS3ObjectStore(options: CreateS3ObjectStoreOptions): S3ObjectStore {
  return new S3ObjectStore(options);
}

export function assertObjectStoragePrefix(prefix: string): void {
  if (
    prefix === '' ||
    prefix.startsWith('/') ||
    prefix.endsWith('/') ||
    prefix.split('/').some((segment) => segment === '' || segment === '..')
  ) {
    throw new Error(
      'Object-storage prefix must be non-empty without leading, trailing, repeated, or parent-directory segments.',
    );
  }
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = (error as {name?: unknown}).name;
  return typeof name === 'string' ? name : undefined;
}

function isNotFoundError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NoSuchKey' || name === 'NotFound';
}
