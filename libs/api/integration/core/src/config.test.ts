describe('integration provider config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('enables built-in providers by default', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.INTEGRATIONS_ENABLE_CRON_PROVIDER).toBe(true);
    expect(config.INTEGRATIONS_ENABLE_WEBHOOK_PROVIDER).toBe(true);
  });

  it('points Jam at the hosted MCP server and API by default', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(String(config.JAM_MCP_ENDPOINT)).toBe('https://mcp.jam.dev/mcp');
    expect(String(config.JAM_API_BASE_URL)).toBe('https://api.jam.dev');
  });

  it('disables third-party providers by default', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.INTEGRATIONS_ENABLE_LINEAR_PROVIDER).toBe(false);
    expect(config.INTEGRATIONS_ENABLE_POSTHOG_PROVIDER).toBe(false);
  });

  it('allows disabling the built-in cron provider', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_CRON_PROVIDER', 'false');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.INTEGRATIONS_ENABLE_CRON_PROVIDER).toBe(false);
  });
});
