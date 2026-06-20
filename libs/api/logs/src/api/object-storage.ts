import type {Readable} from 'node:stream';
import {DeleteObjectCommand, HeadBucketCommand, S3Client} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';
import {config} from '#config.js';
import {type LogObjectKeyParams, logObjectKey} from '#core/entities/log-object.js';

let _client: S3Client | undefined;

/** Lazily-built S3 client targeting the configured object store (Garage in dev). */
export function s3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: config.LOG_STORAGE_S3_ENDPOINT,
      region: config.LOG_STORAGE_S3_REGION,
      forcePathStyle: config.LOG_STORAGE_S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.LOG_STORAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: config.LOG_STORAGE_S3_SECRET_ACCESS_KEY,
      },
      // Fail fast: a slow or black-holed endpoint must not hang callers behind
      // SDK backoff. One retry, short connect/request timeouts.
      maxAttempts: 2,
      requestHandler: {connectionTimeout: 1_000, requestTimeout: 3_000},
    });
  }
  return _client;
}

export function closeS3Client(): void {
  _client?.destroy();
  _client = undefined;
}

/** Readiness probe: true when the configured bucket answers a HEAD. Used by the app readiness check, not at process boot. */
export async function checkBucketReachable(): Promise<boolean> {
  try {
    await s3Client().send(new HeadBucketCommand({Bucket: config.LOG_STORAGE_S3_BUCKET}));
    return true;
  } catch {
    return false;
  }
}

let _uploadClient: S3Client | undefined;

/**
 * S3 client for streaming compaction uploads. `s3Client()` is tuned fail-fast for the
 * readiness HEAD, but each multipart part upload can take as long as the link needs, so
 * the per-request timeout is disabled here. Temporal owns the retry budget, so the SDK
 * keeps only a small attempt count for transient connection blips.
 */
export function uploadS3Client(): S3Client {
  if (!_uploadClient) {
    _uploadClient = new S3Client({
      endpoint: config.LOG_STORAGE_S3_ENDPOINT,
      region: config.LOG_STORAGE_S3_REGION,
      forcePathStyle: config.LOG_STORAGE_S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.LOG_STORAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: config.LOG_STORAGE_S3_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
      requestHandler: {connectionTimeout: 5_000, requestTimeout: 0},
    });
  }
  return _uploadClient;
}

export function closeUploadS3Client(): void {
  _uploadClient?.destroy();
  _uploadClient = undefined;
}

/**
 * Per-attempt object key for a compacted stream: the stream's stable prefix
 * (`logObjectKey` -> `{prefix}/{workspaceId}/{jobId}/{stepId}/{attempt}`, shared with retention
 * and workspace prefix deletes) plus a unique `uploadToken` leaf. Each compaction attempt
 * uploads to its own key and the winner records it atomically, so a slow or zombie attempt
 * can never overwrite a published object. Losing and crashed attempts leave a leaf under the
 * same prefix, reclaimed by the bucket's incomplete-multipart-abort rule and prefix-scoped
 * retention.
 */
export function compactedObjectKey(identity: LogObjectKeyParams, uploadToken: string): string {
  return `${logObjectKey(config.LOG_STORAGE_S3_PREFIX, identity)}/${uploadToken}`;
}

// lib-storage defaults (5MB parts, queue of 4); we pin a small queue so peak buffer memory
// stays bounded under concurrent compactions (queueSize x partSize per active upload).
const UPLOAD_PART_SIZE = 5 * 1024 * 1024;
const UPLOAD_QUEUE_SIZE = 2;

export interface PutCompactedObjectParams {
  key: string;
  body: Readable;
  metadata: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: () => void;
}

/**
 * Streams `body` (gzip-compressed NDJSON) to the compacted object via a multipart upload.
 * `Content-Encoding: gzip` so a browser-direct presigned GET auto-decompresses. Aborts the
 * multipart upload when `signal` fires, so a cancelled activity leaves no dangling parts.
 *
 * A hard crash (no graceful abort) can still strand incomplete multipart parts, which on
 * pay-per-storage providers (S3, R2) bill until aborted. The worker never sets bucket
 * policy, so the deployed bucket must carry an `AbortIncompleteMultipartUpload` lifecycle
 * rule. `dev/garage/bootstrap.sh` provisions it for local Garage; self-hosters set the same
 * rule on their bucket.
 */
export async function putCompactedObject(params: PutCompactedObjectParams): Promise<void> {
  const upload = new Upload({
    client: uploadS3Client(),
    partSize: UPLOAD_PART_SIZE,
    queueSize: UPLOAD_QUEUE_SIZE,
    params: {
      Bucket: config.LOG_STORAGE_S3_BUCKET,
      Key: params.key,
      Body: params.body,
      ContentType: 'application/x-ndjson',
      ContentEncoding: 'gzip',
      Metadata: params.metadata,
    },
  });

  if (params.onProgress) upload.on('httpUploadProgress', params.onProgress);
  if (params.signal) {
    // Subscribe before the aborted-check so a signal firing between them cannot be missed,
    // then handle the already-aborted case eagerly (an already-aborted signal never fires 'abort').
    params.signal.addEventListener(
      'abort',
      () => {
        void upload.abort().catch(() => undefined);
      },
      {once: true},
    );
    if (params.signal.aborted) {
      await upload.abort().catch(() => undefined);
      throw new Error('Compaction upload aborted before it started');
    }
  }

  await upload.done();
}

/**
 * Deletes a compacted object. S3 `DeleteObject` is idempotent (a missing key is a success),
 * so retention and the publish orphan guard can call it freely without a pre-check.
 */
export async function deleteObject(key: string): Promise<void> {
  await s3Client().send(new DeleteObjectCommand({Bucket: config.LOG_STORAGE_S3_BUCKET, Key: key}));
}
