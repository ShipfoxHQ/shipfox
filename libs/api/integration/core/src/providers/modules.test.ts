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

  it('loads Linear when the provider is enabled', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_LINEAR_PROVIDER', 'true');
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['linear', 'cron', 'webhook']);
    expect(parts[0]?.provider).toMatchObject({
      provider: 'linear',
      displayName: 'Linear',
      adapters: {},
    });
  });

  it('loads Slack when the provider is enabled', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_SLACK_PROVIDER', 'true');
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['slack', 'cron', 'webhook']);
    expect(parts[0]?.provider).toMatchObject({
      provider: 'slack',
      displayName: 'Slack',
      adapters: {},
    });
  });

  it('loads Jira when the provider is enabled', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_JIRA_PROVIDER', 'true');
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['jira', 'cron', 'webhook']);
    expect(parts[0]?.provider).toMatchObject({provider: 'jira', displayName: 'Jira'});
  });
});
