const ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

describe('agent config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('imports with an API-key-only instance default provider key', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'openai');
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const module = await import('./config.js');

    expect(module.config.AGENT_DEFAULT_PROVIDER).toBe('openai');
    expect(module.config.AGENT_DEFAULT_PROVIDER_API_KEY).toBe('sk-instance-secret');
  });

  it('throws when an instance key is set for a multi-field provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'azure-openai-responses');
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const importConfig = import('./config.js');

    await expect(importConfig).rejects.toThrow(
      'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER',
    );
  });

  it('throws when an instance key is set without an instance default provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const importConfig = import('./config.js');

    await expect(importConfig).rejects.toThrow(
      'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER',
    );
  });

  it('imports without an instance key', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY);
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'azure-openai-responses');

    const module = await import('./config.js');

    expect(module.config.AGENT_DEFAULT_PROVIDER).toBe('azure-openai-responses');
    expect(module.config.AGENT_DEFAULT_PROVIDER_API_KEY).toBeUndefined();
  });
});
