import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {IntegrationProviderError} from '#core/errors.js';
import {createProjectConfigService} from '#core/project-config-service.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import type {SourceControlProvider} from '#core/providers/source-control.js';
import {createSourceControlIntegrationService} from '#core/source-control-service.js';
import {createIntegrationsInterModulePresentation} from './inter-module.js';

const workspaceId = crypto.randomUUID();
const connectionId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);

const connection: IntegrationConnection = {
  id: connectionId,
  workspaceId,
  provider: 'gitea',
  externalAccountId: 'gitea-owner',
  slug: 'gitea_owner',
  displayName: 'Gitea',
  lifecycleStatus: 'active',
  repositoryAccessMode: 'all',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function projectsClient(
  overrides: Partial<{sourceExternalRepositoryId: string; sourceDefaultBranch: string | null}> = {},
): ProjectsModuleClient {
  return {
    getProjectById: async ({projectId: id}: {projectId: string}) => {
      await Promise.resolve();
      return {
        project:
          id === projectId
            ? {
                id: projectId,
                workspaceId,
                sourceConnectionId: connectionId,
                sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
                sourceRepositoryOwner: 'gitea-owner',
                sourceRepositoryName: 'platform',
                sourceDefaultBranch: 'main',
                name: 'Platform',
                ...overrides,
              }
            : null,
      };
    },
  } as unknown as ProjectsModuleClient;
}

function createClient(params: {
  sourceControl?: Partial<SourceControlProvider>;
  projects?: ProjectsModuleClient;
}) {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(integrationsInterModuleContract);
  const registry = createIntegrationProviderRegistry([
    {
      provider: 'gitea',
      displayName: 'Gitea',
      adapters: {
        source_control: {
          listRepositories: vi.fn(),
          resolveRepository: vi.fn(),
          listFiles: vi.fn(async () => await Promise.resolve({files: [], nextCursor: null})),
          fetchFile: vi.fn(),
          resolveTriggerReference: () => null,
          resolveRef: vi.fn(async (input) => await Promise.resolve({ref: input.ref, commit: HEAD})),
          ...params.sourceControl,
        },
      },
    },
  ]);
  const getIntegrationConnectionById = async (id: string) => {
    await Promise.resolve();
    return id === connectionId ? connection : undefined;
  };
  const sourceControl = createSourceControlIntegrationService({
    registry,
    getIntegrationConnectionById,
  });
  transport.register(
    createIntegrationsInterModulePresentation({
      registry,
      sourceControl,
      projects: params.projects ?? projectsClient(),
      projectConfig: createProjectConfigService({
        registry,
        sourceControl,
        getIntegrationConnectionById,
      }),
      getIntegrationConnectionById,
    }),
  );
  transport.seal();
  return client;
}

describe('integrations inter-module config reads', () => {
  const input = {workspaceId, projectId};

  it('answers project-not-found for a project in another workspace', async () => {
    const client = createClient({});

    const error = await client
      .getConfigSource({workspaceId: crypto.randomUUID(), projectId})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.getConfigSource, error)) {
      expect(error.code).toBe('project-not-found');
      expect(error.details).toEqual({projectId});
    } else {
      throw error;
    }
  });

  it('answers project-not-found for a missing project', async () => {
    const client = createClient({});

    const error = await client
      .listConfigFiles({workspaceId, projectId: crypto.randomUUID(), limit: 10})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.listConfigFiles, error)) {
      expect(error.code).toBe('project-not-found');
    } else {
      throw error;
    }
  });

  it('reads the source from the project row and pins the head of the default branch', async () => {
    const client = createClient({});

    await expect(client.getConfigSource(input)).resolves.toEqual({
      source: {
        kind: 'linked',
        provider: 'gitea',
        connectionId,
        externalRepositoryId: 'gitea:gitea-owner/platform',
        owner: 'gitea-owner',
        name: 'platform',
        defaultBranch: 'main',
      },
      head: {ref: 'refs/heads/main', commit: HEAD},
      historySupported: false,
    });
  });

  it('marks a managed repository as managed', async () => {
    const client = createClient({
      projects: projectsClient({
        sourceExternalRepositoryId: `managed-vcs:${crypto.randomUUID()}`,
      }),
    });

    const result = await client.getConfigSource(input);

    expect(result.source.kind).toBe('managed');
  });

  it('keeps the source readable while the provider is down', async () => {
    const client = createClient({
      sourceControl: {
        resolveRef: async () => {
          await Promise.resolve();
          throw new IntegrationProviderError('provider-unavailable', 'GitHub is down');
        },
      },
    });

    const result = await client.getConfigSource(input);

    expect(result.head).toBeNull();
    expect(result.source).toMatchObject({
      owner: 'gitea-owner',
      name: 'platform',
      defaultBranch: 'main',
    });
  });

  it('lists the config files at the commit the default branch points at', async () => {
    const listFiles = vi.fn(async () => {
      await Promise.resolve();
      return {
        files: [{path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 12}],
        nextCursor: 'cursor-2',
      };
    });
    const client = createClient({sourceControl: {listFiles}});

    const result = await client.listConfigFiles({...input, limit: 50});

    expect(result).toEqual({
      commit: HEAD,
      files: [{path: '.shipfox/workflows/ci.yml', type: 'file', size: 12}],
      nextCursor: 'cursor-2',
    });
    expect(listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ref: HEAD, prefix: '.shipfox/', limit: 50}),
    );
  });

  it('reads a file at a pinned commit without resolving a ref', async () => {
    const resolveRef = vi.fn();
    const fetchFile = vi.fn(async (fileInput: {ref: string; path: string}) => {
      await Promise.resolve();
      return {path: fileInput.path, ref: fileInput.ref, content: 'name: CI\n'};
    });
    const client = createClient({sourceControl: {resolveRef, fetchFile}});

    const result = await client.readConfigFile({
      ...input,
      ref: OLDER,
      path: '.shipfox/workflows/ci.yml',
    });

    expect(result).toEqual({
      path: '.shipfox/workflows/ci.yml',
      commit: OLDER,
      content: 'name: CI\n',
    });
    expect(resolveRef).not.toHaveBeenCalled();
  });

  it.each([
    'src/index.ts',
    '.shipfox',
    '.shipfox/../secrets.yml',
    '.shipfox//ci.yml',
    '.shipfox/.git/config',
    '.shipfox\\ci.yml',
  ])('rejects the file path %s', async (path) => {
    const client = createClient({});

    await expect(client.readConfigFile({...input, path})).rejects.toThrow();
  });

  it('surfaces provider read failures as provider-failure', async () => {
    const client = createClient({
      sourceControl: {
        fetchFile: async () => {
          await Promise.resolve();
          throw new IntegrationProviderError('file-not-found', 'No such file');
        },
      },
    });

    const error = await client
      .readConfigFile({...input, path: '.shipfox/workflows/missing.yml'})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.readConfigFile, error)) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toMatchObject({reason: 'file-not-found'});
    } else {
      throw error;
    }
  });

  it('lists the commits that changed a path', async () => {
    const listCommits = vi.fn(async () => {
      await Promise.resolve();
      return {
        commits: [
          {
            oid: HEAD,
            message: 'Add CI',
            authorName: 'Ada',
            authoredAt: new Date('2026-10-01T10:00:00.000Z'),
            htmlUrl: 'https://gitea.local/commit/1',
          },
          {
            oid: OLDER,
            message: 'Init',
            authorName: 'Bob',
            authoredAt: new Date('2026-09-01T10:00:00.000Z'),
          },
        ],
        nextCursor: null,
      };
    });
    const client = createClient({sourceControl: {listCommits}});

    const result = await client.listConfigCommits({
      ...input,
      path: '.shipfox/workflows/ci.yml',
      limit: 20,
    });

    expect(result).toEqual({
      commit: HEAD,
      commits: [
        {
          oid: HEAD,
          message: 'Add CI',
          authorName: 'Ada',
          authoredAt: '2026-10-01T10:00:00.000Z',
          htmlUrl: 'https://gitea.local/commit/1',
        },
        {oid: OLDER, message: 'Init', authorName: 'Bob', authoredAt: '2026-09-01T10:00:00.000Z'},
      ],
      nextCursor: null,
    });
    expect(listCommits).toHaveBeenCalledWith(
      expect.objectContaining({ref: HEAD, path: '.shipfox/workflows/ci.yml', limit: 20}),
    );
  });

  it('answers history-unsupported when the provider keeps no history', async () => {
    const client = createClient({});

    const error = await client
      .listConfigCommits({...input, path: '.shipfox', limit: 20})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.listConfigCommits, error)) {
      expect(error.code).toBe('history-unsupported');
      expect(error.details).toEqual({provider: 'gitea'});
    } else {
      throw error;
    }
  });
});
