describe('S3 credential validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('accepts an explicit access key pair', async () => {
    vi.stubEnv('LOG_STORAGE_S3_ACCESS_KEY_ID', 'explicit-access-key');
    vi.stubEnv('LOG_STORAGE_S3_SECRET_ACCESS_KEY', 'explicit-secret-key');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_STORAGE_S3_ACCESS_KEY_ID).toBe('explicit-access-key');
    expect(config.LOG_STORAGE_S3_SECRET_ACCESS_KEY).toBe('explicit-secret-key');
  });

  it('accepts no explicit credentials for the ambient provider chain', async () => {
    vi.stubEnv('LOG_STORAGE_S3_ACCESS_KEY_ID', undefined);
    vi.stubEnv('LOG_STORAGE_S3_SECRET_ACCESS_KEY', undefined);
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_STORAGE_S3_ACCESS_KEY_ID).toBeUndefined();
    expect(config.LOG_STORAGE_S3_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it.each([
    ['explicit-access-key', undefined],
    [undefined, 'explicit-secret-key'],
  ])('rejects a partial explicit credential pair', async (accessKeyId, secretAccessKey) => {
    vi.stubEnv('LOG_STORAGE_S3_ACCESS_KEY_ID', accessKeyId);
    vi.stubEnv('LOG_STORAGE_S3_SECRET_ACCESS_KEY', secretAccessKey);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'LOG_STORAGE_S3_ACCESS_KEY_ID and LOG_STORAGE_S3_SECRET_ACCESS_KEY must be set together',
    );
  });
});

describe('LOG_RETENTION_DAYS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['0', '-5', '1.5'])('fails startup when LOG_RETENTION_DAYS is %s', async (value) => {
    vi.stubEnv('LOG_RETENTION_DAYS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('LOG_RETENTION_DAYS');
  });

  it('accepts a whole-day value of 1 or greater', async () => {
    vi.stubEnv('LOG_RETENTION_DAYS', '30');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_RETENTION_DAYS).toBe(30);
  });
});

describe('LOG_STREAM_REAP_AFTER_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Reaping a stream a still-valid lease is appending to silently truncates live logs, so a value
  // at or below the job lease TTL (default 90m = 5400s) must fail startup.
  it.each([
    '0',
    '-100',
    '5400',
  ])('fails startup when LOG_STREAM_REAP_AFTER_SECONDS is %s (at or below the default lease TTL)', async (value) => {
    vi.stubEnv('LOG_STREAM_REAP_AFTER_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('LOG_STREAM_REAP_AFTER_SECONDS');
  });

  it('accepts a value above the lease TTL', async () => {
    vi.stubEnv('LOG_STREAM_REAP_AFTER_SECONDS', '9000');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_STREAM_REAP_AFTER_SECONDS).toBe(9000);
  });

  // The check reads the actual configured lease TTL, not a hardcoded floor: raising the lease past
  // the reaper window must fail startup even though the value clears the default lease.
  it('fails when AUTH_JOB_LEASE_TOKEN_EXPIRES_IN is raised above the reaper window', async () => {
    vi.stubEnv('AUTH_JOB_LEASE_TOKEN_EXPIRES_IN', '180m');
    vi.stubEnv('LOG_STREAM_REAP_AFTER_SECONDS', '9000');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('LOG_STREAM_REAP_AFTER_SECONDS');
  });

  // The converse: a small reaper window is fine when the lease is correspondingly small, proving
  // the bound tracks the lease rather than a fixed 5400s floor.
  it('accepts a small reaper window when the lease TTL is correspondingly small', async () => {
    vi.stubEnv('AUTH_JOB_LEASE_TOKEN_EXPIRES_IN', '5m');
    vi.stubEnv('LOG_STREAM_REAP_AFTER_SECONDS', '600');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_STREAM_REAP_AFTER_SECONDS).toBe(600);
  });
});

describe('LOG_MAX_SESSION_LINE_BYTES validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fails startup when the session line cap exceeds the append body limit', async () => {
    vi.stubEnv('LOG_APPEND_BODY_LIMIT_BYTES', '1024');
    vi.stubEnv('LOG_MAX_SESSION_LINE_BYTES', '2048');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('LOG_APPEND_BODY_LIMIT_BYTES');
  });

  it('accepts a session line cap equal to the append body limit', async () => {
    vi.stubEnv('LOG_APPEND_BODY_LIMIT_BYTES', '2048');
    vi.stubEnv('LOG_MAX_SESSION_LINE_BYTES', '2048');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_MAX_SESSION_LINE_BYTES).toBe(2048);
  });
});
