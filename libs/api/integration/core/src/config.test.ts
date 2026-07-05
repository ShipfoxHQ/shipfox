describe('integration provider config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('enables built-in cron and webhook providers by default', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.INTEGRATIONS_ENABLE_CRON_PROVIDER).toBe(true);
    expect(config.INTEGRATIONS_ENABLE_WEBHOOK_PROVIDER).toBe(true);
  });

  it('allows disabling the built-in cron provider', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_CRON_PROVIDER', 'false');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.INTEGRATIONS_ENABLE_CRON_PROVIDER).toBe(false);
  });
});
