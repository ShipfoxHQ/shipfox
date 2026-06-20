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
