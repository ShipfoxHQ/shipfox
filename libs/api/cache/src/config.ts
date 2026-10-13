import {CACHE_MAX_PARTS, CACHE_PART_SIZE_BYTES} from '@shipfox/api-cache-dto';
import {bool, createConfig, num, str, url} from '@shipfox/config';

export const config = createConfig({
  CACHE_STORAGE_S3_ENDPOINT: url({
    desc: 'Optional endpoint override for cache archives. Leave it unset to use OBJECT_STORAGE_S3_ENDPOINT.',
    default: undefined,
  }),
  CACHE_STORAGE_S3_REGION: str({
    desc: 'Optional region override for cache archives. Leave it unset to use OBJECT_STORAGE_S3_REGION.',
    default: undefined,
  }),
  CACHE_STORAGE_S3_BUCKET: str({
    desc: 'Optional bucket override for cache archives. Leave it unset to use OBJECT_STORAGE_S3_BUCKET. The bucket needs an AbortIncompleteMultipartUpload lifecycle rule of one day.',
    default: undefined,
  }),
  CACHE_STORAGE_S3_PREFIX: str({
    desc: 'Key prefix under which cache archives are stored in the bucket. Set this to host several modules in one bucket, each under its own prefix. Use a value without a leading or trailing slash. Defaults to cache.',
    default: 'cache',
  }),
  CACHE_STORAGE_S3_ACCESS_KEY_ID: str({
    desc: 'Optional access key ID override for cache archives. Set it with CACHE_STORAGE_S3_SECRET_ACCESS_KEY, or leave both unset to use the shared object-store credentials.',
    default: undefined,
  }),
  CACHE_STORAGE_S3_SECRET_ACCESS_KEY: str({
    desc: 'Optional secret access key override for cache archives. Set it with CACHE_STORAGE_S3_ACCESS_KEY_ID, or leave both unset to use the shared object-store credentials.',
    default: undefined,
  }),
  CACHE_STORAGE_S3_FORCE_PATH_STYLE: bool({
    desc: 'Optional addressing-mode override for cache archives. Leave it unset to use OBJECT_STORAGE_S3_FORCE_PATH_STYLE.',
    default: undefined,
  }),
  CACHE_STORAGE_PUBLIC_ENDPOINT: url({
    desc: 'Optional endpoint written into the signed URLs handed to runners. Set it when runners reach the object store by another name than the API does, such as a public hostname for an internal endpoint. Leave it unset to sign URLs with the endpoint the API uses.',
    default: undefined,
  }),
  CACHE_MAX_ENTRY_BYTES: num({
    desc: 'Largest compressed cache entry a job may save, in bytes. A larger save is skipped with a warning in the job. Defaults to 10 GiB.',
    default: 10_737_418_240,
  }),
  CACHE_URL_TTL_SECONDS: num({
    desc: 'Lifetime, in seconds, of the signed upload and download URLs handed to runners. A transfer that outlives its URL fails and counts as a miss or a skipped save. Must be between 1 and 604800 (7 days). Defaults to 3600 (one hour).',
    default: 3600,
  }),
  CACHE_DEFAULT_RETENTION_DAYS: num({
    desc: 'How many days a cache entry is kept after its last use when the workspace has not set its own retention. Must be a whole number of days, 1 or greater, and at most CACHE_MAX_RETENTION_DAYS. Defaults to 7 days.',
    default: 7,
  }),
  CACHE_MAX_RETENTION_DAYS: num({
    desc: 'Longest retention, in days, that a workspace may set for its cache entries. Must be a whole number of days, 1 or greater. Defaults to 90 days.',
    default: 90,
  }),
  CACHE_WORKSPACE_MAX_BYTES: num({
    desc: 'Most bytes of cache entries one workspace may store. Above it, the least recently used entries are evicted, and a larger single entry is not saved. Must be a whole number, 1 or greater. Leave it unset for no limit. Ignored when the application composes its own storage policy.',
    default: undefined,
  }),
});

const MAX_PRESIGN_TTL_SECONDS = 604_800;

if (
  !Number.isInteger(config.CACHE_URL_TTL_SECONDS) ||
  config.CACHE_URL_TTL_SECONDS < 1 ||
  config.CACHE_URL_TTL_SECONDS > MAX_PRESIGN_TTL_SECONDS
) {
  throw new Error(
    `CACHE_URL_TTL_SECONDS must be a whole number between 1 and ${MAX_PRESIGN_TTL_SECONDS}; got ${config.CACHE_URL_TTL_SECONDS}`,
  );
}

const maxEntryBytesLimit = CACHE_MAX_PARTS * CACHE_PART_SIZE_BYTES;
if (
  !Number.isInteger(config.CACHE_MAX_ENTRY_BYTES) ||
  config.CACHE_MAX_ENTRY_BYTES < 1 ||
  config.CACHE_MAX_ENTRY_BYTES > maxEntryBytesLimit
) {
  throw new Error(
    `CACHE_MAX_ENTRY_BYTES must be a whole number between 1 and ${maxEntryBytesLimit}, the most one multipart upload can hold; got ${config.CACHE_MAX_ENTRY_BYTES}`,
  );
}

if (!Number.isInteger(config.CACHE_MAX_RETENTION_DAYS) || config.CACHE_MAX_RETENTION_DAYS < 1) {
  throw new Error(
    `CACHE_MAX_RETENTION_DAYS (${config.CACHE_MAX_RETENTION_DAYS}) must be a whole number of days >= 1.`,
  );
}

if (
  !Number.isInteger(config.CACHE_DEFAULT_RETENTION_DAYS) ||
  config.CACHE_DEFAULT_RETENTION_DAYS < 1 ||
  config.CACHE_DEFAULT_RETENTION_DAYS > config.CACHE_MAX_RETENTION_DAYS
) {
  throw new Error(
    `CACHE_DEFAULT_RETENTION_DAYS (${config.CACHE_DEFAULT_RETENTION_DAYS}) must be a whole number of days between 1 and CACHE_MAX_RETENTION_DAYS (${config.CACHE_MAX_RETENTION_DAYS}).`,
  );
}

if (
  config.CACHE_WORKSPACE_MAX_BYTES !== undefined &&
  (!Number.isInteger(config.CACHE_WORKSPACE_MAX_BYTES) || config.CACHE_WORKSPACE_MAX_BYTES < 1)
) {
  throw new Error(
    `CACHE_WORKSPACE_MAX_BYTES (${config.CACHE_WORKSPACE_MAX_BYTES}) must be a whole number of bytes >= 1.`,
  );
}
