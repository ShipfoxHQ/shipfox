import {bool, createConfig, num, str, url} from '@shipfox/config';

export const config = createConfig({
  LOG_STORAGE_S3_ENDPOINT: url({
    desc: 'Endpoint URL of the S3-compatible object store that holds compacted logs. Defaults to the bundled local-development Garage (http://localhost:3900); set it to your object store endpoint for production.',
    default: 'http://localhost:3900',
  }),
  LOG_STORAGE_S3_REGION: str({
    desc: 'Region passed to the S3 client. Any value works for Garage; set the real region for AWS S3. Defaults to garage for local development.',
    default: 'garage',
  }),
  LOG_STORAGE_S3_BUCKET: str({
    desc: 'Name of the bucket that stores compacted log objects. Defaults to shipfox-logs (created by dev/garage/bootstrap.sh); create the bucket and set this for production.',
    default: 'shipfox-logs',
  }),
  LOG_STORAGE_S3_PREFIX: str({
    desc: 'Key prefix under which compacted log objects are stored in the bucket. Set this to host several modules in one bucket, each under its own prefix. Use a value without a leading or trailing slash. Defaults to logs.',
    default: 'logs',
  }),
  LOG_STORAGE_S3_ACCESS_KEY_ID: str({
    desc: 'Access key id used to authenticate to the object store. Defaults to the local-development Garage key; set real credentials for production.',
    default: 'GK000000000000000000000000',
  }),
  LOG_STORAGE_S3_SECRET_ACCESS_KEY: str({
    desc: 'Secret access key used to authenticate to the object store. Defaults to the local-development Garage secret; set real credentials for production.',
    default: '0000000000000000000000000000000000000000000000000000000000000000',
  }),
  LOG_STORAGE_S3_FORCE_PATH_STYLE: bool({
    desc: 'Whether to address the bucket as a path (endpoint/bucket) instead of a subdomain. Set it to true for Garage and MinIO; false works for AWS S3.',
    default: true,
  }),
  LOG_BUDGET_BASE_BYTES: num({
    desc: 'Base of the per-job log accrual budget, in stored bytes (raw NDJSON the server keeps, framing included). A job may always store this much before the time-based rate is added. Defaults to 5 MiB.',
    default: 5_242_880,
  }),
  LOG_BUDGET_RATE_BYTES_PER_MINUTE: num({
    desc: 'Stored bytes added to the per-job log budget for each minute since the first log append. Defaults to 1 MiB per minute.',
    default: 1_048_576,
  }),
  LOG_STREAM_CLOSE_GRACE_SECONDS: num({
    desc: 'How long to wait after a job reaches a terminal state before force-closing any of its log streams the runner never ended itself (it died, was capped, or its log spool failed). The wait lets a last in-flight chunk land before the stream is marked truncated. Defaults to 120 seconds.',
    default: 120,
  }),
  LOG_COMPACTION_RECONCILE_STALE_SECONDS: num({
    desc: 'How long a closed log stream may stay uncompacted before the reconcile cron re-drives it. The event-triggered compaction normally runs within seconds of close; this backstop only re-drives streams whose compaction never started or permanently failed. Defaults to 900 seconds (15 minutes).',
    default: 900,
  }),
  LOG_APPEND_BODY_LIMIT_BYTES: num({
    desc: 'Maximum size of a single log append request body, in bytes. The runner flushes at most a few hundred KB per request and each record caps at 16 KiB, so 1 MiB is generous headroom. This also bounds how far a job can overshoot its log budget: the one append that crosses the budget is stored in full before the job is capped. Defaults to 1 MiB.',
    default: 1_048_576,
  }),
});
