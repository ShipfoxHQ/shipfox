import {S3Client} from '@aws-sdk/client-s3';
import type {ObjectStorageS3Profile} from './config.js';

export interface ObjectStorageS3Clients {
  readonly control: S3Client;
  readonly transfer: S3Client;
  /** Signs URLs only. It never sends a request. */
  readonly presign: S3Client;
}

export interface ObjectStorageS3ClientOptions {
  /** Maximum duration of one data-transfer request. Zero leaves it unbounded. */
  readonly transferRequestTimeoutMs?: number | undefined;
  /** Endpoint written into presigned URLs when callers reach the store by another name. */
  readonly publicEndpoint?: string | undefined;
}

export function createObjectStorageS3Clients(
  profile: ObjectStorageS3Profile,
  options: ObjectStorageS3ClientOptions = {},
): ObjectStorageS3Clients {
  const transferRequestTimeoutMs = options.transferRequestTimeoutMs ?? 0;
  if (!Number.isSafeInteger(transferRequestTimeoutMs) || transferRequestTimeoutMs < 0) {
    throw new RangeError('Object-storage transfer request timeout must be a non-negative integer.');
  }

  const connection = {
    endpoint: profile.endpoint,
    region: profile.region,
    forcePathStyle: profile.forcePathStyle,
    ...(profile.credentials ? {credentials: profile.credentials} : {}),
  };

  return {
    control: new S3Client({
      ...connection,
      maxAttempts: 2,
      requestHandler: {
        connectionTimeout: 1_000,
        requestTimeout: 3_000,
        throwOnRequestTimeout: true,
      },
    }),
    transfer: new S3Client({
      ...connection,
      maxAttempts: 3,
      requestHandler: {
        connectionTimeout: 5_000,
        requestTimeout: transferRequestTimeoutMs,
        throwOnRequestTimeout: transferRequestTimeoutMs > 0,
      },
    }),
    // The SDK's default checksum calculation puts the CRC32 of an empty body into a presigned
    // PUT's query string, so the real part body fails the store's checksum check.
    presign: new S3Client({
      ...connection,
      endpoint: options.publicEndpoint ?? profile.endpoint,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    }),
  };
}
