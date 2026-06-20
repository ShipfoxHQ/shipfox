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
    desc: 'Maximum size of a single log append request body, in bytes. Shared by both stream kinds (kind is a query param, so the limit is set once on the route). Must be at least LOG_MAX_SESSION_LINE_BYTES so an agent_session producer can send one whole line; sized generously for agent sessions that inline large content (e.g. base64 images). Bounds the per-job budget overshoot to one body. Defaults to 8 MiB.',
    default: 8_388_608,
  }),
  LOG_MAX_SESSION_LINE_BYTES: num({
    desc: 'Maximum size of one agent_session JSONL line, in bytes. A session line over this is rejected with 400. Must be at most LOG_APPEND_BODY_LIMIT_BYTES (a line that cannot fit in one request body could never be accepted). Sized generously for large session entries (e.g. base64 images, big tool results). Defaults to 4 MiB.',
    default: 4_194_304,
  }),
});

// envalid's num has no range support, and the invariant spans two variables, so enforce
// it here. If the body limit is below the line cap, a legitimate large session line could
// never fit in one request body — Fastify would reject it before our validator runs. Fail
// fast at startup rather than 400 valid lines forever.
if (config.LOG_APPEND_BODY_LIMIT_BYTES < config.LOG_MAX_SESSION_LINE_BYTES) {
  throw new Error(
    `LOG_APPEND_BODY_LIMIT_BYTES (${config.LOG_APPEND_BODY_LIMIT_BYTES}) must be >= LOG_MAX_SESSION_LINE_BYTES (${config.LOG_MAX_SESSION_LINE_BYTES}).`,
  );
}
