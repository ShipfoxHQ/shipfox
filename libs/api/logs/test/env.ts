process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_PORT = '5432';
process.env.POSTGRES_USERNAME = 'shipfox';
process.env.POSTGRES_PASSWORD = 'password';
process.env.POSTGRES_DATABASE = 'api_test';
process.env.POSTGRES_MAX_CONNECTIONS = '5';
process.env.AUTH_JWT_SECRET = 'test-secret';
process.env.AUTH_JOB_LEASE_TOKEN_SECRET = 'test-lease-secret';

// Small accrual budget so cap/budget tests use tiny payloads: base 100 bytes,
// rate 60 bytes/min (1 byte/second).
process.env.LOG_BUDGET_BASE_BYTES = '100';
process.env.LOG_BUDGET_RATE_BYTES_PER_MINUTE = '60';

// Dummy object-storage config so config validation passes without a live Garage;
// no test in this package talks to S3 (hot chunks live in Postgres).
process.env.LOG_STORAGE_S3_ENDPOINT = 'http://localhost:3900';
process.env.LOG_STORAGE_S3_REGION = 'garage';
process.env.LOG_STORAGE_S3_BUCKET = 'shipfox-logs-test';
process.env.LOG_STORAGE_S3_ACCESS_KEY_ID = 'test-access-key';
process.env.LOG_STORAGE_S3_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.LOG_STORAGE_S3_FORCE_PATH_STYLE = 'true';

process.env.TZ = 'UTC';
