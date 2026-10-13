describe('cache config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to seven days of retention and a one hour URL lifetime', async () => {
    const {config} = await import('./config.js');

    expect(config.CACHE_DEFAULT_RETENTION_DAYS).toBe(7);
    expect(config.CACHE_MAX_RETENTION_DAYS).toBe(90);
    expect(config.CACHE_URL_TTL_SECONDS).toBe(3600);
    expect(config.CACHE_STORAGE_S3_PREFIX).toBe('cache');
    expect(config.CACHE_WORKSPACE_MAX_BYTES).toBeUndefined();
  });

  it.each([
    ['CACHE_URL_TTL_SECONDS', '0'],
    ['CACHE_URL_TTL_SECONDS', '604801'],
    ['CACHE_URL_TTL_SECONDS', '0.5'],
    ['CACHE_MAX_ENTRY_BYTES', '0'],
    ['CACHE_MAX_ENTRY_BYTES', String(10_001 * 32 * 1024 * 1024)],
    ['CACHE_DEFAULT_RETENTION_DAYS', '0'],
    ['CACHE_DEFAULT_RETENTION_DAYS', '91'],
    ['CACHE_MAX_RETENTION_DAYS', '1.5'],
    ['CACHE_WORKSPACE_MAX_BYTES', '0'],
  ])('rejects %s=%s', async (name, value) => {
    vi.stubEnv(name, value);

    await expect(import('./config.js')).rejects.toThrow(name);
  });
});
