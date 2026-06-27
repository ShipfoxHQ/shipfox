process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_PORT = '5432';
process.env.POSTGRES_USERNAME = 'shipfox';
process.env.POSTGRES_PASSWORD = 'password';
process.env.POSTGRES_DATABASE = 'api_test';
process.env.POSTGRES_MAX_CONNECTIONS = '5';
process.env.AUTH_JWT_SECRET = 'test-secret';
process.env.AUTH_JOB_LEASE_TOKEN_SECRET = 'test-lease-secret';
process.env.AUTH_RUNNER_SESSION_TOKEN_SECRET = 'test-runner-session-secret';

// Small accrual budget so cap/budget tests use tiny payloads: base 100 bytes,
// rate 60 bytes/min (1 byte/second).
process.env.LOG_BUDGET_BASE_BYTES = '100';
process.env.LOG_BUDGET_RATE_BYTES_PER_MINUTE = '60';

// Modest body limit (64 KiB) so the route 413 test uses a small payload.
process.env.LOG_APPEND_BODY_LIMIT_BYTES = '65536';

// Small agent_session line cap so the over-cap test uses a tiny payload. Must stay
// <= LOG_APPEND_BODY_LIMIT_BYTES for the startup invariant.
process.env.LOG_MAX_SESSION_LINE_BYTES = '512';

// Tiny inline read page so the read-path drain/has_more test pages with small fixtures.
process.env.LOG_READ_INLINE_MAX_BYTES = '256';

// Real Garage dev credentials (bootstrap.sh creates the shipfox-logs-test bucket and grants
// this key). Compaction tests upload to and read back from live Garage from compose.yml.
process.env.LOG_STORAGE_S3_ENDPOINT = 'http://localhost:3900';
process.env.LOG_STORAGE_S3_REGION = 'garage';
process.env.LOG_STORAGE_S3_BUCKET = 'shipfox-logs-test';
process.env.LOG_STORAGE_S3_ACCESS_KEY_ID = 'GK000000000000000000000000';
process.env.LOG_STORAGE_S3_SECRET_ACCESS_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000';
process.env.LOG_STORAGE_S3_FORCE_PATH_STYLE = 'true';

process.env.TZ = 'UTC';
