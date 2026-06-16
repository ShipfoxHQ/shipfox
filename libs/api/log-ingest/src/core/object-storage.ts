import {HeadBucketCommand, S3Client} from '@aws-sdk/client-s3';
import {config} from '#config.js';

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
    });
  }
  return _client;
}

export function closeS3Client(): void {
  _client?.destroy();
  _client = undefined;
}

export interface LogObjectKeyParams {
  workspaceId: string;
  jobId: string;
  stepId: string;
  attempt: number;
}

/** Object layout `logs/{workspace}/{job}/{step}/{attempt}` so retention and workspace deletion are prefix operations. */
export function logObjectKey({workspaceId, jobId, stepId, attempt}: LogObjectKeyParams): string {
  return `logs/${workspaceId}/${jobId}/${stepId}/${attempt}`;
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
