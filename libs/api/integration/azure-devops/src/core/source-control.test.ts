import {type IntegrationConnection, MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';
import type {
  AzureDevOpsApiClient,
  AzureDevOpsClientOptions,
  AzureDevOpsRepository,
} from '#api/client.js';
import {AzureDevOpsIntegrationProviderError} from './errors.js';
import {AzureDevOpsSourceControlProvider} from './source-control.js';

const randomUUIDMock = vi.hoisted(() => vi.fn<() => string>());
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  randomUUIDMock.mockImplementation(() => actual.randomUUID());
  return {...actual, randomUUID: randomUUIDMock};
});

const PROJECT_ID = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
const REPOSITORY_ID = '5febef5a-833d-4e14-b9c0-14cb638f91e6';
const EXTERNAL_ID = `azure-devops:${PROJECT_ID}/${REPOSITORY_ID}`;
const VALID_COMMIT = 'a'.repeat(40);
const ZERO_COMMIT = '0'.repeat(40);

const REPOSITORY: AzureDevOpsRepository = {
  id: REPOSITORY_ID,
  name: 'platform',
  projectId: PROJECT_ID,
  projectName: 'Fabrikam',
  defaultBranch: 'main',
  remoteUrl: 'https://contoso@dev.azure.com/contoso/Fabrikam/_git/platform',
  webUrl: 'https://dev.azure.com/contoso/Fabrikam/_git/platform',
  isDisabled: false,
};

function repository(overrides: Partial<AzureDevOpsRepository>): AzureDevOpsRepository {
  return {...REPOSITORY, ...overrides};
}

function adoClient(overrides: Partial<AzureDevOpsApiClient> = {}): AzureDevOpsApiClient {
  return {
    getConnectionData: vi.fn(),
    listRepositories: vi.fn(() => Promise.resolve([REPOSITORY])),
    getRepository: vi.fn(() => Promise.resolve(REPOSITORY)),
    resolveRef: vi.fn(() => Promise.resolve(VALID_COMMIT)),
    getBranch: vi.fn(() => Promise.resolve({commitSha: 'branch-head'})),
    getTag: vi.fn(() => Promise.reject(new Error('not used'))),
    listTree: vi.fn(() =>
      Promise.resolve({
        blobs: [{path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 64}],
        truncated: false,
      }),
    ),
    fetchFileContent: vi.fn(() =>
      Promise.resolve({path: '.shipfox/workflows/ci.yml', content: 'name: CI\n', size: 9}),
    ),
    getPullRequest: vi.fn(),
    createPullRequest: vi.fn(),
    createPullRequestComment: vi.fn(),
    ...overrides,
  };
}

function connection(): IntegrationConnection<'azure-devops'> {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'azure-devops',
    externalAccountId: 'contoso',
    slug: 'azure_devops_contoso',
    displayName: 'Azure DevOps contoso',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function providerWith(
  client: AzureDevOpsApiClient,
  credential: {kind: 'pat' | 'bearer'; token: string} = {kind: 'pat', token: 'test-pat'},
) {
  const createClient = vi.fn((_options: AzureDevOpsClientOptions) => client);
  const credentials = {resolve: vi.fn(() => Promise.resolve(credential))};
  return {
    provider: new AzureDevOpsSourceControlProvider(createClient, credentials),
    createClient,
    credentials,
  };
}

describe('AzureDevOpsSourceControlProvider', () => {
  describe('client per connection', () => {
    it('builds the client from the connection organization and its own credential', async () => {
      const {provider, createClient, credentials} = providerWith(adoClient());
      const conn = connection();

      await provider.resolveRepository({connection: conn, externalRepositoryId: EXTERNAL_ID});

      expect(credentials.resolve).toHaveBeenCalledWith(conn);
      expect(createClient).toHaveBeenCalledWith({
        organization: 'contoso',
        credential: {kind: 'pat', token: 'test-pat'},
      });
    });
  });

  describe('repositories', () => {
    it('lists active repositories with project/name as full name, sorted', async () => {
      const client = adoClient({
        listRepositories: vi.fn(() =>
          Promise.resolve([
            repository({id: 'r2', name: 'web', projectName: 'Fabrikam'}),
            REPOSITORY,
            repository({id: 'r3', name: 'old', isDisabled: true}),
            repository({id: 'r4', name: 'empty', defaultBranch: null}),
          ]),
        ),
      });
      const {provider} = providerWith(client);

      const page = await provider.listRepositories({connection: connection(), limit: 10});

      expect(page.repositories.map((repo) => repo.fullName)).toEqual([
        'Fabrikam/platform',
        'Fabrikam/web',
      ]);
      expect(page.repositories[0]).toEqual({
        externalRepositoryId: EXTERNAL_ID,
        owner: 'Fabrikam',
        name: 'platform',
        fullName: 'Fabrikam/platform',
        defaultBranch: 'main',
        visibility: 'private',
        cloneUrl: 'https://dev.azure.com/contoso/Fabrikam/_git/platform',
        htmlUrl: REPOSITORY.webUrl,
      });
      expect(page.nextCursor).toBeNull();
    });

    it('filters by search and pages with an offset cursor', async () => {
      const repos = ['api', 'app', 'apex', 'web'].map((name) =>
        repository({id: `id-${name}`, name}),
      );
      const {provider} = providerWith(
        adoClient({listRepositories: vi.fn(() => Promise.resolve(repos))}),
      );

      const first = await provider.listRepositories({
        connection: connection(),
        limit: 2,
        search: 'AP',
      });
      const second = await provider.listRepositories({
        connection: connection(),
        limit: 2,
        search: 'ap',
        cursor: first.nextCursor ?? undefined,
      });

      expect(first.repositories.map((repo) => repo.name)).toEqual(['apex', 'api']);
      expect(first.nextCursor).toBe('2');
      expect(second.repositories.map((repo) => repo.name)).toEqual(['app']);
      expect(second.nextCursor).toBeNull();
    });

    it('resolves a repository from its project and repository ids', async () => {
      const client = adoClient();
      const {provider} = providerWith(client);

      const snapshot = await provider.resolveRepository({
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
      });

      expect(snapshot.fullName).toBe('Fabrikam/platform');
      expect(client.getRepository).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        repositoryId: REPOSITORY_ID,
      });
    });

    it('rejects a malformed external repository id before any api call', async () => {
      const client = adoClient();
      const {provider} = providerWith(client);

      await expect(
        provider.resolveRepository({
          connection: connection(),
          externalRepositoryId: 'azure-devops:only-one-part',
        }),
      ).rejects.toMatchObject({reason: 'repository-not-found'});
      expect(client.getRepository).not.toHaveBeenCalled();
    });

    it('rejects an external repository id of another provider', async () => {
      const {provider} = providerWith(adoClient());

      await expect(
        provider.resolveRepository({
          connection: connection(),
          externalRepositoryId: `gitea:${PROJECT_ID}/${REPOSITORY_ID}`,
        }),
      ).rejects.toMatchObject({reason: 'repository-not-found'});
    });

    it('treats a disabled repository as not found', async () => {
      const {provider} = providerWith(
        adoClient({getRepository: vi.fn(() => Promise.resolve(repository({isDisabled: true})))}),
      );

      await expect(
        provider.resolveRepository({connection: connection(), externalRepositoryId: EXTERNAL_ID}),
      ).rejects.toMatchObject({reason: 'repository-not-found'});
    });

    it('reports an empty repository as having no default branch', async () => {
      const {provider} = providerWith(
        adoClient({getRepository: vi.fn(() => Promise.resolve(repository({defaultBranch: null})))}),
      );

      await expect(
        provider.resolveRepository({connection: connection(), externalRepositoryId: EXTERNAL_ID}),
      ).rejects.toMatchObject({reason: 'ref-not-found'});
    });
  });

  describe('files', () => {
    it('lists files under a prefix at the resolved commit', async () => {
      const client = adoClient({
        listTree: vi.fn(() =>
          Promise.resolve({
            blobs: [
              {path: 'src/index.ts', type: 'file' as const, size: 10},
              {path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 64},
              {path: '.shipfox/workflows/link.yml', type: 'symlink' as const, size: 5},
              {path: '.shipfoxx/other.yml', type: 'file' as const, size: 1},
            ],
            truncated: false,
          }),
        ),
      });
      const {provider} = providerWith(client);

      const page = await provider.listFiles({
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
        ref: 'refs/heads/main',
        prefix: '.shipfox/',
        limit: 10,
      });

      expect(page).toEqual({
        files: [
          {path: '.shipfox/workflows/ci.yml', type: 'file', size: 64},
          {path: '.shipfox/workflows/link.yml', type: 'symlink', size: 5},
        ],
        nextCursor: null,
      });
      expect(client.resolveRef).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        repositoryId: REPOSITORY_ID,
        ref: 'refs/heads/main',
      });
      expect(client.listTree).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        repositoryId: REPOSITORY_ID,
        commitSha: VALID_COMMIT,
      });
    });

    it('paginates files with an offset cursor', async () => {
      const blobs = ['a', 'b', 'c'].map((name) => ({
        path: `.shipfox/${name}.yml`,
        type: 'file' as const,
        size: 1,
      }));
      const {provider} = providerWith(
        adoClient({listTree: vi.fn(() => Promise.resolve({blobs, truncated: false}))}),
      );
      const input = {
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
        ref: 'refs/heads/main',
        prefix: '.shipfox',
        limit: 2,
      };

      const first = await provider.listFiles(input);
      const second = await provider.listFiles({...input, cursor: first.nextCursor ?? undefined});

      expect(first.files.map((file) => file.path)).toEqual(['.shipfox/a.yml', '.shipfox/b.yml']);
      expect(first.nextCursor).toBe('2');
      expect(second.files.map((file) => file.path)).toEqual(['.shipfox/c.yml']);
      expect(second.nextCursor).toBeNull();
    });

    it('fetches a file at the commit the ref resolves to', async () => {
      const client = adoClient();
      const {provider} = providerWith(client);

      const file = await provider.fetchFile({
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
        ref: 'refs/heads/main',
        path: '.shipfox/workflows/ci.yml',
      });

      expect(file).toEqual({
        path: '.shipfox/workflows/ci.yml',
        ref: 'refs/heads/main',
        content: 'name: CI\n',
      });
      expect(client.fetchFileContent).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        repositoryId: REPOSITORY_ID,
        path: '.shipfox/workflows/ci.yml',
        commitSha: VALID_COMMIT,
      });
    });

    it('rejects file content over the limit even when the size field undercounts it', async () => {
      const {provider} = providerWith(
        adoClient({
          fetchFileContent: vi.fn(() =>
            Promise.resolve({
              path: 'big.yml',
              content: 'é'.repeat(MAX_REPOSITORY_FILE_BYTES / 2 + 1),
              size: 10,
            }),
          ),
        }),
      );

      await expect(
        provider.fetchFile({
          connection: connection(),
          externalRepositoryId: EXTERNAL_ID,
          ref: 'refs/heads/main',
          path: 'big.yml',
        }),
      ).rejects.toMatchObject({reason: 'content-too-large'});
    });
  });

  describe('refs', () => {
    it('resolves a branch ref to the commit it points at', async () => {
      const client = adoClient();
      const {provider} = providerWith(client);

      const resolved = await provider.resolveRef({
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
        ref: 'refs/heads/main',
      });

      expect(resolved).toEqual({ref: 'refs/heads/main', commit: 'branch-head'});
      expect(client.getBranch).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        repositoryId: REPOSITORY_ID,
        branch: 'main',
      });
      expect(client.getTag).not.toHaveBeenCalled();
    });

    it('only looks up tags for a tag ref', async () => {
      const client = adoClient({getTag: vi.fn(() => Promise.resolve({commitSha: 'tag-head'}))});
      const {provider} = providerWith(client);

      const resolved = await provider.resolveRef({
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
        ref: 'refs/tags/v1.0',
      });

      expect(resolved.commit).toBe('tag-head');
      expect(client.getBranch).not.toHaveBeenCalled();
    });

    it('falls back to a tag for an unnamespaced ref', async () => {
      const client = adoClient({
        getBranch: vi.fn(() =>
          Promise.reject(new AzureDevOpsIntegrationProviderError('ref-not-found', 'no branch')),
        ),
        getTag: vi.fn(() => Promise.resolve({commitSha: 'tag-head'})),
      });
      const {provider} = providerWith(client);

      const resolved = await provider.resolveRef({
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
        ref: 'release/2026',
      });

      expect(resolved.commit).toBe('tag-head');
    });

    it('maps a ref that is neither branch nor tag to ref-not-found after confirming the repository', async () => {
      const notFound = () =>
        Promise.reject(new AzureDevOpsIntegrationProviderError('ref-not-found', 'missing'));
      const client = adoClient({getBranch: vi.fn(notFound), getTag: vi.fn(notFound)});
      const {provider} = providerWith(client);

      await expect(
        provider.resolveRef({
          connection: connection(),
          externalRepositoryId: EXTERNAL_ID,
          ref: 'release/2026',
        }),
      ).rejects.toMatchObject({reason: 'ref-not-found'});
      expect(client.getRepository).toHaveBeenCalled();
    });

    it('rejects a pull-request ref as not resolvable', async () => {
      const {provider} = providerWith(adoClient());

      await expect(
        provider.resolveRef({
          connection: connection(),
          externalRepositoryId: EXTERNAL_ID,
          ref: 'refs/pull/7/merge',
        }),
      ).rejects.toMatchObject({reason: 'ref-invalid'});
    });

    it('propagates non-not-found branch failures without a tag fallback', async () => {
      const client = adoClient({
        getBranch: vi.fn(() =>
          Promise.reject(new AzureDevOpsIntegrationProviderError('access-denied', 'denied')),
        ),
      });
      const {provider} = providerWith(client);

      await expect(
        provider.resolveRef({
          connection: connection(),
          externalRepositoryId: EXTERNAL_ID,
          ref: 'release/2026',
        }),
      ).rejects.toMatchObject({reason: 'access-denied'});
      expect(client.getTag).not.toHaveBeenCalled();
    });
  });

  describe('trigger references', () => {
    function pushEvent(overrides: Record<string, unknown> = {}) {
      return {
        eventType: 'git.push',
        resource: {
          refUpdates: [
            {name: 'refs/heads/main', oldObjectId: 'b'.repeat(40), newObjectId: VALID_COMMIT},
          ],
          repository: {id: REPOSITORY_ID, name: 'platform', project: {id: PROJECT_ID}},
          pushedBy: {uniqueName: 'coen@example.com', displayName: 'Coen'},
          ...overrides,
        },
      };
    }

    it('normalizes a push to the first updated ref', () => {
      const {provider} = providerWith(adoClient());

      expect(provider.resolveTriggerReference(pushEvent())).toEqual({
        externalRepositoryId: EXTERNAL_ID,
        ref: 'refs/heads/main',
        commit: VALID_COMMIT,
        actor: 'coen@example.com',
      });
    });

    it('ignores a branch deletion', () => {
      const {provider} = providerWith(adoClient());

      const event = pushEvent({
        refUpdates: [{name: 'refs/heads/old', oldObjectId: VALID_COMMIT, newObjectId: ZERO_COMMIT}],
      });

      expect(provider.resolveTriggerReference(event)).toBeNull();
    });

    it('normalizes a pull request to its source branch and last source commit', () => {
      const {provider} = providerWith(adoClient());

      const result = provider.resolveTriggerReference({
        eventType: 'git.pullrequest.created',
        resource: {
          pullRequestId: 42,
          sourceRefName: 'refs/heads/feat/ID-1-x',
          lastMergeSourceCommit: {commitId: VALID_COMMIT},
          repository: {id: REPOSITORY_ID, project: {id: PROJECT_ID}},
          createdBy: {uniqueName: 'coen@example.com'},
        },
      });

      expect(result).toEqual({
        externalRepositoryId: EXTERNAL_ID,
        ref: 'refs/heads/feat/ID-1-x',
        commit: VALID_COMMIT,
        actor: 'coen@example.com',
      });
    });

    it('ignores a pull request from a fork', () => {
      const {provider} = providerWith(adoClient());

      const result = provider.resolveTriggerReference({
        eventType: 'git.pullrequest.created',
        resource: {
          pullRequestId: 42,
          sourceRefName: 'refs/heads/feat/x',
          lastMergeSourceCommit: {commitId: VALID_COMMIT},
          repository: {id: REPOSITORY_ID, project: {id: PROJECT_ID}},
          forkSource: {name: 'refs/heads/feat/x', repository: {id: 'fork-repo'}},
        },
      });

      expect(result).toBeNull();
    });

    it('ignores payloads without a usable repository, ref or commit', () => {
      const {provider} = providerWith(adoClient());

      expect(provider.resolveTriggerReference(null)).toBeNull();
      expect(provider.resolveTriggerReference({eventType: 'git.push'})).toBeNull();
      expect(
        provider.resolveTriggerReference(pushEvent({repository: {id: REPOSITORY_ID}})),
      ).toBeNull();
      expect(
        provider.resolveTriggerReference(
          pushEvent({refUpdates: [{name: 'refs/heads/main', newObjectId: 'not-a-sha'}]}),
        ),
      ).toBeNull();
    });
  });

  describe('checkout', () => {
    it('creates a checkout spec on the default branch with a credential-free clone URL', async () => {
      const {provider} = providerWith(adoClient());

      const spec = await provider.createCheckoutSpec({
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
      });

      expect(spec.repositoryUrl).toBe('https://dev.azure.com/contoso/Fabrikam/_git/platform');
      expect(spec.ref).toBe('main');
      expect(spec.target).toEqual({kind: 'external-id', externalRepositoryId: EXTERNAL_ID});
      expect(spec.credentials).toMatchObject({
        username: 'shipfox',
        token: 'test-pat',
        renewal: {mode: 'on-rejection'},
      });
    });

    it('creates a checkout spec from a name target', async () => {
      const client = adoClient();
      const {provider} = providerWith(client);

      const spec = await provider.createCheckoutSpec({
        connection: connection(),
        target: {kind: 'name', owner: 'Fabrikam', name: 'platform'},
        ref: 'feat/x',
      });

      expect(client.getRepository).toHaveBeenCalledWith({
        projectId: 'Fabrikam',
        repositoryId: 'platform',
      });
      expect(spec.ref).toBe('feat/x');
      expect(spec.target).toEqual({kind: 'external-id', externalRepositoryId: EXTERNAL_ID});
    });

    it('hands an OAuth access token to git as the password', async () => {
      const {provider} = providerWith(adoClient(), {kind: 'bearer', token: 'entra-token'});

      const credentials = await provider.createCheckoutCredentials({
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
        permissions: {contents: 'read'},
      });

      expect(credentials.token).toBe('entra-token');
    });

    it('rejects a checkout ref git would treat as an option', async () => {
      const client = adoClient();
      const {provider} = providerWith(client);

      await expect(
        provider.createCheckoutSpec({
          connection: connection(),
          externalRepositoryId: EXTERNAL_ID,
          ref: '--upload-pack=evil',
        }),
      ).rejects.toMatchObject({reason: 'ref-invalid'});
      expect(client.getRepository).not.toHaveBeenCalled();
    });

    it('rejects input that names both a target and an external id', async () => {
      const {provider} = providerWith(adoClient());

      await expect(
        provider.createCheckoutCredentials({
          connection: connection(),
          externalRepositoryId: EXTERNAL_ID,
          target: {kind: 'name', owner: 'Fabrikam', name: 'platform'},
          permissions: {contents: 'read'},
        }),
      ).rejects.toMatchObject({reason: 'provider-rejected'});
    });

    it('never hands back the generation git rejected, even when the next random id repeats it', async () => {
      // Two real UUIDs never collide, so the guard is only exercised by forcing a repeat.
      randomUUIDMock
        .mockReturnValueOnce('gen-rejected')
        .mockReturnValueOnce('gen-rejected')
        .mockReturnValueOnce('gen-fresh');
      const {provider} = providerWith(adoClient());
      const input = {
        connection: connection(),
        externalRepositoryId: EXTERNAL_ID,
        permissions: {contents: 'read' as const},
      };

      const first = await provider.createCheckoutCredentials(input);
      const second = await provider.createCheckoutCredentials({
        ...input,
        rejectedGeneration: first.generation,
      });

      expect(first.generation).toBe('gen-rejected');
      expect(second.generation).toBe('gen-fresh');
    });
  });
});
