// The config reads the flag when the entry point loads, so it must be set before the imports run.
vi.hoisted(() => {
  vi.stubEnv('AGENT_ACCESS_ADMIN_MCP_ENABLED', 'true');
});

import * as entryPoint from './index.js';

describe('agent-access module', () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('imports the package entry point with the admin MCP flag on', () => {
    expect(entryPoint.createAgentAccessModule).toBeTypeOf('function');
  });

  it('refuses to compose with the admin MCP flag on and no auth, workspaces, or projects client', () => {
    expect(() => entryPoint.createAgentAccessModule()).toThrow(
      'The admin MCP endpoint requires the auth, workspaces, and projects clients',
    );
  });
});
