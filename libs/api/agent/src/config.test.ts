const ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

describe('agent config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('imports with an API-key-only instance default provider key', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_MODEL_PROVIDER_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'openai');
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const module = await import('./config.js');

    expect(module.config.AGENT_DEFAULT_PROVIDER).toBe('openai');
    expect(module.config.AGENT_DEFAULT_PROVIDER_API_KEY).toBe('sk-instance-secret');
  });

  it('throws when an instance key is set for a multi-field provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_MODEL_PROVIDER_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'azure-openai-responses');
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const importConfig = import('./config.js');

    await expect(importConfig).rejects.toThrow(
      'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER',
    );
  });

  it('throws when an instance key is set without an instance default provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_MODEL_PROVIDER_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const importConfig = import('./config.js');

    await expect(importConfig).rejects.toThrow(
      'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER',
    );
  });

  it('imports without an instance key', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_MODEL_PROVIDER_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'azure-openai-responses');

    const module = await import('./config.js');

    expect(module.config.AGENT_DEFAULT_PROVIDER).toBe('azure-openai-responses');
    expect(module.config.AGENT_DEFAULT_PROVIDER_API_KEY).toBeUndefined();
  });

  it('defaults custom provider egress to local-development friendly settings', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_MODEL_PROVIDER_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);

    const module = await import('./config.js');

    expect(module.config.AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS).toBe(true);
    expect(module.config.AGENT_CUSTOM_PROVIDER_HOST_DENYLIST).toBe('');
  });

  it('imports custom provider egress cloud overrides', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_MODEL_PROVIDER_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS', 'false');
    vi.stubEnv('AGENT_CUSTOM_PROVIDER_HOST_DENYLIST', 'metadata.google.internal,10.0.0.0/8');

    const module = await import('./config.js');

    expect(module.config.AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS).toBe(false);
    expect(module.config.AGENT_CUSTOM_PROVIDER_HOST_DENYLIST).toBe(
      'metadata.google.internal,10.0.0.0/8',
    );
  });
});
