const linearEnvNames = [
  'LINEAR_OAUTH_CLIENT_ID',
  'LINEAR_OAUTH_CLIENT_SECRET',
  'LINEAR_WEBHOOK_SIGNING_SECRET',
  'LINEAR_OAUTH_REDIRECT_URL',
] as const;

describe('linear config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exports validated Linear config from the package root', async () => {
    vi.stubEnv('LINEAR_MCP_ENDPOINT', undefined);
    vi.stubEnv('LINEAR_GRAPHQL_ENDPOINT', undefined);
    vi.resetModules();

    const {config} = await import('#index.js');

    for (const name of linearEnvNames) {
      expect(config[name]).toBe(process.env[name]);
    }
    expect(config.LINEAR_MCP_ENDPOINT).toBe('https://mcp.linear.app/mcp');
    expect(config.LINEAR_GRAPHQL_ENDPOINT).toBe('https://api.linear.app/graphql');
  });

  it('accepts a compatible Linear MCP endpoint override', async () => {
    vi.stubEnv('LINEAR_MCP_ENDPOINT', 'https://linear-mcp.example.test/mcp');
    vi.resetModules();

    const {config} = await import('#index.js');

    expect(config.LINEAR_MCP_ENDPOINT).toBe('https://linear-mcp.example.test/mcp');
  });
});
