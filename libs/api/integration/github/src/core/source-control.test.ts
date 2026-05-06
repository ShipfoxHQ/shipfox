import {sql} from 'drizzle-orm';
import type {GithubApiClient} from '#api/client.js';
import {db} from '#db/db.js';
import {upsertGithubInstallation} from '#db/installations.js';
import {GithubIntegrationProviderError} from './errors.js';
import {GithubSourceControlProvider} from './source-control.js';

function githubClient(overrides: Partial<GithubApiClient> = {}): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.resolve('token')),
    listUserInstallations: vi.fn(() => Promise.resolve({installationIds: [], nextCursor: null})),
    getInstallation: vi.fn(() => {
      throw new Error('not used');
    }),
    listInstallationRepositories: vi.fn(() =>
      Promise.resolve({
        repositories: [
          {
            id: 42,
            ownerLogin: 'shipfox',
            name: 'platform',
            fullName: 'shipfox/platform',
            defaultBranch: 'main',
            private: true,
            visibility: 'private',
            cloneUrl: 'https://github.com/shipfox/platform.git',
            htmlUrl: 'https://github.com/shipfox/platform',
          },
        ],
        nextCursor: '2',
      }),
    ),
    getRepository: vi.fn(() =>
      Promise.resolve({
        id: 42,
        ownerLogin: 'shipfox',
        name: 'platform',
        fullName: 'shipfox/platform',
        defaultBranch: 'main',
        private: true,
        visibility: 'private',
        cloneUrl: 'https://github.com/shipfox/platform.git',
        htmlUrl: 'https://github.com/shipfox/platform',
      }),
    ),
    listRepositoryFiles: vi.fn(() =>
      Promise.resolve({
        files: [{path: '.shipfox/workflows/ci.yml', size: 64}],
        nextCursor: null,
      }),
    ),
    fetchRepositoryFile: vi.fn(() =>
      Promise.resolve({
        path: '.shipfox/workflows/ci.yml',
        content: 'name: CI\njobs:\n  build:\n    steps:\n      - run: pnpm test\n',
        size: 58,
      }),
    ),
    ...overrides,
  };
}

describe('GithubSourceControlProvider', () => {
  let connectionId: string;
  let installationId: number;

  beforeEach(() => {
    connectionId = crypto.randomUUID();
    installationId = Math.floor(Math.random() * 1_000_000) + 1;
  });

  async function createConnectionWithInstallation(): Promise<void> {
    await db().execute(sql`
      INSERT INTO integrations_connections (
        id,
        workspace_id,
        provider,
        external_account_id,
        display_name,
        lifecycle_status
      )
      VALUES (
        ${connectionId},
        ${crypto.randomUUID()},
        'github',
        ${String(installationId)},
        'GitHub shipfox',
        'active'
      )
    `);
    await upsertGithubInstallation({
      connectionId,
      installationId: String(installationId),
      accountLogin: 'shipfox',
      accountType: 'Organization',
      repositorySelection: 'all',
      latestEvent: {id: 123},
    });
  }

  function connection() {
    return {
      id: connectionId,
      workspaceId: crypto.randomUUID(),
      provider: 'github' as const,
      externalAccountId: '123',
      displayName: 'GitHub shipfox',
      lifecycleStatus: 'active' as const,
      capabilities: ['source_control' as const],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('lists repositories using installation auth metadata', async () => {
    await createConnectionWithInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.listRepositories({
      connection: connection(),
      limit: 50,
    });

    expect(result.repositories[0]?.externalRepositoryId).toBe('github:shipfox/platform');
    expect(result.repositories[0]?.visibility).toBe('private');
    expect(result.nextCursor).toBe('2');
    expect(github.listInstallationRepositories).toHaveBeenCalledWith({
      installationId,
      limit: 50,
      cursor: undefined,
    });
  });

  it('resolves repositories directly from the provider-owned repository id', async () => {
    await createConnectionWithInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.resolveRepository({
      connection: connection(),
      externalRepositoryId: 'github:shipfox/platform',
    });

    expect(result.fullName).toBe('shipfox/platform');
    expect(github.getRepository).toHaveBeenCalledWith({
      installationId,
      owner: 'shipfox',
      repo: 'platform',
    });
    expect(github.listInstallationRepositories).not.toHaveBeenCalled();
  });

  it('rejects missing installation metadata', async () => {
    const provider = new GithubSourceControlProvider(githubClient());

    const result = provider.listRepositories({
      connection: {
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        provider: 'github',
        externalAccountId: '123',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        capabilities: ['source_control'],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      limit: 50,
    });

    await expect(result).rejects.toBeInstanceOf(GithubIntegrationProviderError);
  });

  it('lists repository files using the provider-owned repository id', async () => {
    await createConnectionWithInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.listFiles({
      connection: connection(),
      externalRepositoryId: 'github:shipfox/platform',
      ref: 'main',
      prefix: '.shipfox/workflows/',
      limit: 100,
    });

    expect(result.files[0]?.path).toBe('.shipfox/workflows/ci.yml');
    expect(github.listRepositoryFiles).toHaveBeenCalledWith({
      installationId,
      owner: 'shipfox',
      repo: 'platform',
      ref: 'main',
      prefix: '.shipfox/workflows/',
      limit: 100,
      cursor: undefined,
    });
  });

  it('fetches repository file contents using the provider-owned repository id', async () => {
    await createConnectionWithInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.fetchFile({
      connection: connection(),
      externalRepositoryId: 'github:shipfox/platform',
      ref: 'main',
      path: '.shipfox/workflows/ci.yml',
    });

    expect(result.content).toContain('name: CI');
    expect(github.fetchRepositoryFile).toHaveBeenCalledWith({
      installationId,
      owner: 'shipfox',
      repo: 'platform',
      ref: 'main',
      path: '.shipfox/workflows/ci.yml',
    });
  });

  it.each([
    'shipfox/platform',
    'github:',
    'github:foo',
    'github:foo/bar/baz',
    'debug:foo/bar',
    '',
  ])('rejects malformed external repository id %s', async (externalRepositoryId) => {
    await createConnectionWithInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = provider.resolveRepository({
      connection: connection(),
      externalRepositoryId,
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(github.getRepository).not.toHaveBeenCalled();
  });

  it('rejects oversized repository file contents', async () => {
    await createConnectionWithInstallation();
    const github = githubClient({
      fetchRepositoryFile: vi.fn(() =>
        Promise.resolve({
          path: '.shipfox/workflows/huge.yml',
          content: 'x'.repeat(1_000_001),
          size: 1_000_001,
        }),
      ),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = provider.fetchFile({
      connection: connection(),
      externalRepositoryId: 'github:shipfox/platform',
      ref: 'main',
      path: '.shipfox/workflows/huge.yml',
    });

    await expect(result).rejects.toMatchObject({reason: 'content-too-large'});
  });
});
