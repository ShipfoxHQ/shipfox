import type {GithubApiClient} from '#api/client.js';
import type {GithubInstallation} from '#db/installations.js';
import {createGithubIntegrationProvider} from '#index.js';
import {githubUserInstallationPage} from '#test/index.js';

function githubClient(): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.resolve('user-token')),
    listUserInstallations: vi.fn(() => Promise.resolve(githubUserInstallationPage([]))),
    getInstallation: vi.fn(() => Promise.reject(new Error('not used'))),
    listInstallationRepositories: vi.fn(() => Promise.reject(new Error('not used'))),
    getRepository: vi.fn(() => Promise.reject(new Error('not used'))),
    listRepositoryFiles: vi.fn(() => Promise.reject(new Error('not used'))),
    fetchRepositoryFile: vi.fn(() => Promise.reject(new Error('not used'))),
    createInstallationToken: vi.fn(() => Promise.reject(new Error('not used'))),
  } as unknown as GithubApiClient;
}

function installation(overrides: Partial<GithubInstallation> = {}): GithubInstallation {
  return {
    id: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    installationId: '123',
    accountLogin: 'shipfox',
    accountType: 'Organization',
    repositorySelection: 'all',
    suspendedAt: null,
    deletedAt: null,
    latestEvent: {},
    installerUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createProvider(lookup: (connectionId: string) => Promise<GithubInstallation | undefined>) {
  return createGithubIntegrationProvider({
    github: githubClient(),
    getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
    connectGithubInstallation: vi.fn() as never,
    coreDb: vi.fn() as never,
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
    publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
    publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
    getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
    updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    getGithubInstallationByConnectionId: lookup,
  });
}

describe('github connectionExternalUrl', () => {
  it('resolves the organization installation settings URL for org accounts', async () => {
    const provider = createProvider(() =>
      Promise.resolve(installation({accountType: 'Organization', accountLogin: 'acme'})),
    );

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBe('https://github.com/organizations/acme/settings/installations/123');
  });

  it('resolves the user installation settings URL for user accounts', async () => {
    const provider = createProvider(() =>
      Promise.resolve(installation({accountType: 'User', accountLogin: 'octocat'})),
    );

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBe('https://github.com/settings/installations/123');
  });

  it('returns undefined when the installation row is missing', async () => {
    const provider = createProvider(() => Promise.resolve(undefined));

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBeUndefined();
  });

  it('returns undefined after the installation is deleted', async () => {
    const provider = createProvider(() => Promise.resolve(installation({deletedAt: new Date()})));

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBeUndefined();
  });
});

describe('github connectionProviderAccess', () => {
  const connection = {id: crypto.randomUUID()};

  it.each([
    ['removed', {deletedAt: new Date()}],
    ['suspended', {suspendedAt: new Date()}],
    ['removed', {deletedAt: new Date(), suspendedAt: new Date()}],
  ] as const)('reports %s for %j', async (expected, overrides) => {
    const provider = createProvider(() => Promise.resolve(installation(overrides)));

    await expect(provider.connectionProviderAccess(connection)).resolves.toBe(expected);
  });

  it('reports nothing for a healthy or missing installation', async () => {
    const healthy = createProvider(() => Promise.resolve(installation()));
    const missing = createProvider(() => Promise.resolve(undefined));

    await expect(healthy.connectionProviderAccess(connection)).resolves.toBeUndefined();
    await expect(missing.connectionProviderAccess(connection)).resolves.toBeUndefined();
  });
});
