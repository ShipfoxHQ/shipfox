describe('loadEnabledProviderModules', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads cron alongside webhook by default', async () => {
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['cron', 'webhook']);
  });

  it('does not load cron when the provider is disabled', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_CRON_PROVIDER', 'false');
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['webhook']);
  });
});
