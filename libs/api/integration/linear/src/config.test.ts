const linearEnvNames = [
  'LINEAR_OAUTH_CLIENT_ID',
  'LINEAR_OAUTH_CLIENT_SECRET',
  'LINEAR_WEBHOOK_SIGNING_SECRET',
  'LINEAR_OAUTH_REDIRECT_URL',
] as const;

describe('linear config', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('exports validated Linear config from the package root', async () => {
    vi.resetModules();

    const {config} = await import('#index.js');

    for (const name of linearEnvNames) {
      expect(config[name]).toBe(process.env[name]);
    }
  });
});
