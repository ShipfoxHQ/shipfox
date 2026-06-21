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

  // The floor keeps the reaper from force-closing a stream a still-valid lease is appending to,
  // which would silently truncate live logs, so a sub-floor value must fail startup.
  it.each([
    '0',
    '-100',
    '5399',
  ])('fails startup when LOG_STREAM_REAP_AFTER_SECONDS is %s', async (value) => {
    vi.stubEnv('LOG_STREAM_REAP_AFTER_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('LOG_STREAM_REAP_AFTER_SECONDS');
  });

  it('accepts a value above the floor', async () => {
    vi.stubEnv('LOG_STREAM_REAP_AFTER_SECONDS', '9000');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_STREAM_REAP_AFTER_SECONDS).toBe(9000);
  });
});
