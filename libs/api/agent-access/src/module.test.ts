// Each test imports the package entry point cold, which can outlast the default 5 s on a busy CI runner.
const COLD_IMPORT_TIMEOUT_MS = 30_000;

describe('agent-access module', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    'imports the package entry point with the admin MCP flag on',
    async () => {
      vi.resetModules();
      vi.stubEnv('AGENT_ACCESS_ADMIN_MCP_ENABLED', 'true');

      const module = await import('./index.js');

      expect(module.createAgentAccessModule).toBeTypeOf('function');
    },
    COLD_IMPORT_TIMEOUT_MS,
  );

  it(
    'refuses to compose with the admin MCP flag on and no auth, workspaces, or projects client',
    async () => {
      vi.resetModules();
      vi.stubEnv('AGENT_ACCESS_ADMIN_MCP_ENABLED', 'true');
      const {createAgentAccessModule} = await import('./index.js');

      expect(() => createAgentAccessModule()).toThrow(
        'The admin MCP endpoint requires the auth, workspaces, and projects clients',
      );
    },
    COLD_IMPORT_TIMEOUT_MS,
  );
});
