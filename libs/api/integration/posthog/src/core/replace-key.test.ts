import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {PosthogApiClient} from '#api/client.js';
import type {PosthogInstallation} from '#db/installations.js';
import type {PosthogCredentialStore} from './credentials.js';
import {handlePosthogReplaceApiKey} from './replace-key.js';

const connection: IntegrationConnection<'posthog'> = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  provider: 'posthog',
  externalAccountId: 'eu:project-1',
  slug: 'posthog_analytics',
  displayName: 'Analytics',
  lifecycleStatus: 'error',
  repositoryAccessMode: 'selected',
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-02T00:00:00.000Z'),
};

const installation: PosthogInstallation = {
  connectionId: connection.id,
  region: 'eu',
  projectId: 'project-1',
  projectName: 'Analytics',
  organizationId: 'organization-1',
  keyHint: 'old1',
  credentialVersion: 3,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-02T00:00:00.000Z'),
};

function api(overrides: Partial<PosthogApiClient> = {}): PosthogApiClient {
  return {
    listProjects: vi.fn(() =>
      Promise.resolve([{id: 'project-1', name: 'Analytics', organizationId: 'organization-1'}]),
    ),
    validateQuery: vi.fn(() => Promise.resolve()),
    probeCredential: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function credentials(): PosthogCredentialStore {
  return {
    getApiKey: vi.fn(() => Promise.resolve('phx_old')),
    setApiKey: vi.fn(() => Promise.resolve()),
    deleteApiKey: vi.fn(() => Promise.resolve(1)),
  };
}

describe('handlePosthogReplaceApiKey', () => {
  it('validates before replacing and activates the same connection', async () => {
    const posthog = api();
    const credentialStore = credentials();
    const updateInstallationCredential = vi.fn(() => Promise.resolve(installation));
    const updateConnection = vi.fn(() =>
      Promise.resolve({...connection, lifecycleStatus: 'active' as const}),
    );
    const withCredentialVersion = vi.fn(
      async (params: {
        callback: (input: {
          tx: unknown;
          installation: PosthogInstallation;
        }) => Promise<IntegrationConnection<'posthog'> | undefined>;
      }) => ({
        matched: true as const,
        value: await params.callback({tx: {}, installation}),
      }),
    );

    const result = await handlePosthogReplaceApiKey({
      connectionId: connection.id,
      apiKey: 'phx_new_key',
      posthog,
      credentials: credentialStore,
      getConnection: async () => connection,
      getInstallation: async () => installation,
      updateConnection,
      withCredentialVersion: withCredentialVersion as never,
      updateInstallationCredential,
    });

    expect(result).toMatchObject({
      id: connection.id,
      slug: connection.slug,
      lifecycleStatus: 'active',
    });
    expect(credentialStore.setApiKey).toHaveBeenCalledWith({
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      apiKey: 'phx_new_key',
    });
    expect(updateInstallationCredential).toHaveBeenCalledWith({
      connectionId: connection.id,
      keyHint: 'phx_new_key',
      credentialVersion: 4,
      tx: {},
    });
  });

  it('does not write the secret when the project is missing', async () => {
    const credentialStore = credentials();
    const posthog = api({
      listProjects: vi.fn(() => Promise.resolve([])),
    });

    await expect(
      handlePosthogReplaceApiKey({
        connectionId: connection.id,
        apiKey: 'phx_new_key',
        posthog,
        credentials: credentialStore,
        getConnection: async () => connection,
        getInstallation: async () => installation,
        updateConnection: vi.fn(),
      }),
    ).rejects.toThrow('cannot access project');

    expect(credentialStore.setApiKey).not.toHaveBeenCalled();
  });
});
