import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {PosthogApiClient} from '#api/client.js';
import type {PosthogInstallation} from '#db/installations.js';
import type {PosthogCredentialStore} from './credentials.js';
import {
  PosthogCredentialVersionMismatchError,
  PosthogIntegrationProviderError,
  PosthogMissingScopesError,
} from './errors.js';
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
    getProject: vi.fn(() =>
      Promise.resolve({id: 'project-1', name: 'Analytics', organizationId: 'organization-1'}),
    ),
    validateQuery: vi.fn(() => Promise.resolve()),
    probeCredential: vi.fn(() => Promise.resolve({status: 200})),
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
    expect(posthog.listProjects).not.toHaveBeenCalled();
    expect(posthog.getProject).toHaveBeenCalledWith({
      region: 'eu',
      apiKey: 'phx_new_key',
      projectId: 'project-1',
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
      getProject: vi.fn(() => Promise.resolve(undefined)),
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

  it.each([
    new PosthogMissingScopesError(['insight:read']),
    new PosthogIntegrationProviderError('access-denied', 'Query permission denied'),
  ])('preserves the previous key when validation fails: %s', async (error) => {
    const credentialStore = credentials();
    const posthog = api();
    if (error instanceof PosthogMissingScopesError)
      vi.mocked(posthog.getProject).mockRejectedValue(error);
    else vi.mocked(posthog.validateQuery).mockRejectedValue(error);
    const updateConnection = vi.fn();
    await expect(
      handlePosthogReplaceApiKey({
        connectionId: connection.id,
        apiKey: 'phx_new_key',
        posthog,
        credentials: credentialStore,
        getConnection: async () => connection,
        getInstallation: async () => installation,
        updateConnection,
      }),
    ).rejects.toBe(error);
    expect(credentialStore.setApiKey).not.toHaveBeenCalled();
    expect(credentialStore.deleteApiKey).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it('does not write the secret when the credential version is stale', async () => {
    const credentialStore = credentials();
    const withCredentialVersion = vi.fn(() =>
      Promise.resolve({matched: false as const, reason: 'version-mismatch' as const}),
    );

    await expect(
      handlePosthogReplaceApiKey({
        connectionId: connection.id,
        apiKey: 'phx_new_key',
        posthog: api(),
        credentials: credentialStore,
        getConnection: async () => connection,
        getInstallation: async () => installation,
        updateConnection: vi.fn(),
        withCredentialVersion,
      }),
    ).rejects.toBeInstanceOf(PosthogCredentialVersionMismatchError);

    expect(credentialStore.setApiKey).not.toHaveBeenCalled();
  });

  it('restores the previous secret when the metadata transaction fails', async () => {
    const credentialStore = credentials();
    const transactionError = new Error('transaction failed');
    const withCredentialVersion = vi.fn(
      async (params: {
        callback: (input: {tx: unknown; installation: PosthogInstallation}) => Promise<unknown>;
      }) => ({
        matched: true as const,
        value: await params.callback({tx: {}, installation}),
      }),
    );

    await expect(
      handlePosthogReplaceApiKey({
        connectionId: connection.id,
        apiKey: 'phx_new_key',
        posthog: api(),
        credentials: credentialStore,
        getConnection: async () => connection,
        getInstallation: async () => installation,
        updateConnection: vi.fn(() => Promise.reject(transactionError)),
        withCredentialVersion: withCredentialVersion as never,
        updateInstallationCredential: vi.fn(() => Promise.resolve(installation)),
      }),
    ).rejects.toBe(transactionError);

    expect(credentialStore.setApiKey).toHaveBeenNthCalledWith(1, {
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      apiKey: 'phx_new_key',
    });
    expect(credentialStore.setApiKey).toHaveBeenNthCalledWith(2, {
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      apiKey: 'phx_old',
    });
    expect(withCredentialVersion).toHaveBeenCalledTimes(2);
  });

  it('does not restore over a newer successful replacement', async () => {
    const credentialStore = credentials();
    const transactionError = new Error('transaction failed');
    const withCredentialVersion = vi
      .fn()
      .mockImplementationOnce(
        async (params: {
          callback: (input: {
            tx: unknown;
            installation: PosthogInstallation;
          }) => Promise<IntegrationConnection<'posthog'> | undefined>;
        }) => ({
          matched: true as const,
          value: await params.callback({tx: {}, installation}),
        }),
      )
      .mockResolvedValueOnce({matched: false as const, reason: 'version-mismatch' as const});

    await expect(
      handlePosthogReplaceApiKey({
        connectionId: connection.id,
        apiKey: 'phx_new_key',
        posthog: api(),
        credentials: credentialStore,
        getConnection: async () => connection,
        getInstallation: async () => installation,
        updateConnection: vi.fn(() => Promise.reject(transactionError)),
        withCredentialVersion: withCredentialVersion as never,
        updateInstallationCredential: vi.fn(() => Promise.resolve(installation)),
      }),
    ).rejects.toBe(transactionError);

    expect(credentialStore.setApiKey).toHaveBeenCalledTimes(1);
    expect(credentialStore.setApiKey).toHaveBeenCalledWith({
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      apiKey: 'phx_new_key',
    });
  });
});
