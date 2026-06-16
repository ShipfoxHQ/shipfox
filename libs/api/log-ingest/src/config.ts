import {bool, createConfig, num, str, url} from '@shipfox/config';

export const config = createConfig({
  LOG_STORAGE_S3_ENDPOINT: url({
    desc: 'Endpoint URL of the S3-compatible object store that holds compacted logs. For the bundled Garage, this is http://localhost:3900 in local development. Required: startup fails when it is missing.',
  }),
  LOG_STORAGE_S3_REGION: str({
    desc: 'Region passed to the S3 client. Any value works for Garage (for example garage); set the real region for AWS S3. Required.',
  }),
  LOG_STORAGE_S3_BUCKET: str({
    desc: 'Name of the bucket that stores compacted log objects. Create it before starting the API. Required.',
  }),
  LOG_STORAGE_S3_ACCESS_KEY_ID: str({
    desc: 'Access key id used to authenticate to the object store. Required.',
  }),
  LOG_STORAGE_S3_SECRET_ACCESS_KEY: str({
    desc: 'Secret access key used to authenticate to the object store. Required.',
  }),
  LOG_STORAGE_S3_FORCE_PATH_STYLE: bool({
    desc: 'Whether to address the bucket as a path (endpoint/bucket) instead of a subdomain. Set it to true for Garage and MinIO; false works for AWS S3.',
    default: true,
  }),
  LOG_BUDGET_BASE_BYTES: num({
    desc: 'Base of the per-job log accrual budget, in payload bytes. A job may always write this much before the time-based rate is added. Defaults to 5 MB.',
    default: 5_242_880,
  }),
  LOG_BUDGET_RATE_BYTES_PER_MINUTE: num({
    desc: 'Payload bytes added to the per-job log budget for each minute since the first log append. Defaults to 1 MB per minute.',
    default: 1_048_576,
  }),
});
