import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {PosthogApiClient, PosthogProject} from '#api/client.js';
import {handlePosthogConnect} from './connect.js';
import {createPosthogCredentialStore} from './credentials.js';
import {PosthogNoProjectAccessError, PosthogProjectNotAccessibleError} from './errors.js';

function project(overrides: Partial<PosthogProject> = {}): PosthogProject {
  return {id: 'project-1', name: 'Analytics', organizationId: 'organization-1', ...overrides};
}

function connection(): IntegrationConnection<'posthog'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'posthog',
    externalAccountId: 'eu:project-1',
    slug: 'posthog_analytics',
    displayName: 'Analytics',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function api(projects: PosthogProject[]): PosthogApiClient {
  return {
    listProjects: vi.fn(() => Promise.resolve(projects)),
    validateQuery: vi.fn(() => Promise.resolve()),
    probeCredential: vi.fn(() => Promise.resolve()),
  };
}

function credentials(options: {failCreate?: boolean} = {}) {
  const values = new Map<string, string>();
  const store = createPosthogCredentialStore({
    resolveConnection: async () => ({workspaceId: 'workspace-1'}),
    secrets: {
      getSecret: async ({namespace}) => values.get(namespace) ?? null,
      setSecrets: ({namespace, values: nextValues}) => {
        if (options.failCreate) throw new Error('secret write failed');
        values.set(namespace, nextValues.API_KEY ?? '');
        return Promise.resolve();
      },
      deleteSecrets: async ({namespace}) => Number(values.delete(namespace)),
    },
  });
  return {store, values};
}

describe('handlePosthogConnect', () => {
  it('auto-connects a single project after validating the query', async () => {
    const posthog = api([project()]);
    const secretState = credentials();
    const createConnection = vi.fn(async () => connection());
    const getExistingConnection = vi.fn(async () => undefined);

    const result = await handlePosthogConnect({
      workspaceId: connection().workspaceId,
      region: 'eu',
      apiKey: 'phx_secret',
      posthog,
      credentials: secretState.store,
      getExistingConnection,
      createConnection,
    });

    expect(result).toMatchObject({
      status: 'connected',
      connection: {id: '00000000-0000-4000-8000-000000000001'},
    });
    expect(getExistingConnection).toHaveBeenCalledWith({
      workspaceId: connection().workspaceId,
      externalAccountId: 'eu:project-1',
    });
    expect(posthog.validateQuery).toHaveBeenCalledWith({
      region: 'eu',
      apiKey: 'phx_secret',
      projectId: 'project-1',
    });
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: connection().workspaceId,
        region: 'eu',
        projectId: 'project-1',
        projectName: 'Analytics',
        organizationId: 'organization-1',
      }),
    );
  });

  it('returns a project picker without writing a secret', async () => {
    const secretState = credentials();
    const result = await handlePosthogConnect({
      workspaceId: 'workspace-1',
      region: 'us',
      apiKey: 'phx_secret',
      posthog: api([project(), project({id: 'project-2', name: 'Billing'})]),
      credentials: secretState.store,
      getExistingConnection: async () => undefined,
      createConnection: vi.fn(),
    });

    expect(result).toMatchObject({status: 'select-project'});
    expect(secretState.values.size).toBe(0);
  });

  it('rejects when the API key cannot access any projects without writing a secret', async () => {
    const secretState = credentials();
    const createConnection = vi.fn();

    await expect(
      handlePosthogConnect({
        workspaceId: 'workspace-1',
        region: 'eu',
        apiKey: 'phx_secret',
        posthog: api([]),
        credentials: secretState.store,
        getExistingConnection: vi.fn(),
        createConnection,
      }),
    ).rejects.toBeInstanceOf(PosthogNoProjectAccessError);

    expect(secretState.values.size).toBe(0);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('rejects a project that is not in the accessible project list without writing a secret', async () => {
    const secretState = credentials();
    const createConnection = vi.fn();

    await expect(
      handlePosthogConnect({
        workspaceId: 'workspace-1',
        region: 'eu',
        apiKey: 'phx_secret',
        projectId: 'project-2',
        posthog: api([project()]),
        credentials: secretState.store,
        getExistingConnection: vi.fn(),
        createConnection,
      }),
    ).rejects.toBeInstanceOf(PosthogProjectNotAccessibleError);

    expect(secretState.values.size).toBe(0);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('removes a secret when connection creation fails', async () => {
    const secretState = credentials();
    const error = new Error('transaction failed');

    await expect(
      handlePosthogConnect({
        workspaceId: 'workspace-1',
        region: 'eu',
        apiKey: 'phx_secret',
        posthog: api([project()]),
        credentials: secretState.store,
        getExistingConnection: async () => undefined,
        createConnection: vi.fn(() => Promise.reject(error)),
      }),
    ).rejects.toBe(error);

    expect(secretState.values.size).toBe(0);
  });

  it('rejects a public project key before making provider calls', async () => {
    const posthog = api([project()]);

    await expect(
      handlePosthogConnect({
        workspaceId: 'workspace-1',
        region: 'eu',
        apiKey: 'phc_public',
        posthog,
        credentials: credentials().store,
        getExistingConnection: async () => undefined,
        createConnection: vi.fn(),
      }),
    ).rejects.toThrow('phx_');
    expect(posthog.listProjects).not.toHaveBeenCalled();
  });
});
