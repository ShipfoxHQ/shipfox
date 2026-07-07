process.env.DATABASE_URL ??= 'postgres://shipfox:shipfox@127.0.0.1:5432/api_test';
process.env.AUTH_JWT_SECRET = 'test-jwt-secret';
process.env.AUTH_JOB_LEASE_TOKEN_SECRET = 'test-lease-secret';
process.env.AUTH_RUNNER_SESSION_TOKEN_SECRET = 'test-runner-session-secret';
process.env.TZ = 'UTC';
