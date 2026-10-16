import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {JamIntrospection, JamIntrospectionClient} from '#api/introspect.js';
import type {JamCredentialStore} from '#core/credentials.js';
import type {CreateJamMcpClient, JamMcpClient} from '#core/mcp-client.js';
import type {JamInstallation} from '#db/installations.js';

export const JAM_TEAM_ID = 'bf9da890-a8ce-4cf6-8627-1e352ddba3c8';
export const JAM_USER_ID = '2b87c817-d4da-47fa-937a-43cf758ace42';

export function jamConnection(
  overrides: Partial<IntegrationConnection<'jam'>> = {},
): IntegrationConnection<'jam'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'jam',
    externalAccountId: JAM_TEAM_ID,
    slug: 'jam',
    displayName: 'Jam',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

export function jamInstallation(overrides: Partial<JamInstallation> = {}): JamInstallation {
  return {
    connectionId: jamConnection().id,
    teamId: JAM_TEAM_ID,
    userId: JAM_USER_ID,
    userName: 'Ada',
    userEmail: 'ada@example.com',
    tokenHint: 'old1',
    credentialVersion: 3,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

export function jamCredentials(token: string | null = 'jam_pat_old'): JamCredentialStore {
  return {
    getToken: vi.fn(() => Promise.resolve(token)),
    setToken: vi.fn(() => Promise.resolve()),
    deleteToken: vi.fn(() => Promise.resolve(1)),
  };
}

export function activeIntrospection(overrides: Partial<JamIntrospection> = {}): JamIntrospection {
  return {
    active: true,
    teamId: JAM_TEAM_ID,
    userId: JAM_USER_ID,
    scopes: ['cli:read', 'mcp:read'],
    ...overrides,
  } as JamIntrospection;
}

export function introspectionClient(result: JamIntrospection): JamIntrospectionClient {
  return {introspect: vi.fn(() => Promise.resolve(result))};
}

export function textResult(value: unknown): CallToolResult {
  return {
    content: [{type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value)}],
  };
}

export function membersResult(
  users: Array<{id: string; name: string; email?: string; role?: string}>,
): CallToolResult {
  return textResult({users});
}

export function mcpClient(
  callTool: (input: {toolId: string; arguments: Record<string, unknown>}) => CallToolResult,
): JamMcpClient & {callTool: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>} {
  return {
    callTool: vi.fn((input: {toolId: string; arguments: Record<string, unknown>}) =>
      Promise.resolve(callTool(input)),
    ),
    close: vi.fn(() => Promise.resolve()),
  };
}

export function clientFactory(client: JamMcpClient): CreateJamMcpClient {
  return vi.fn(() => Promise.resolve(client));
}
