import {createSentryApiClient} from '#api/client.js';
import {SentryIntegrationProviderError} from '#core/errors.js';
import type {SentryInstallation} from '#db/installations.js';
import {
  createSentryReadClient,
  type SentrySecretsStore,
  sentrySecretsNamespace,
} from './read-client.js';

const connectionId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';

function setup() {
  const values = new Map<string, string>();
  const key = (namespace: string, name: string) => `${namespace}/${name}`;
  const secrets: SentrySecretsStore = {
    getSecret: async ({namespace, key: name}) => values.get(key(namespace, name)) ?? null,
    setSecrets: ({namespace, values: next}) => {
      for (const [name, value] of Object.entries(next)) values.set(key(namespace, name), value);
      return Promise.resolve();
    },
  };
  const installation: SentryInstallation = {
    id: 'row-1',
    connectionId,
    installationUuid: 'install-1',
    orgSlug: 'acme',
    status: 'installed',
    codeHash: null,
    installerUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const api = createSentryApiClient();
  api.mintInstallationToken = vi.fn(() =>
    Promise.resolve({
      token: 'new-token',
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    }),
  );
  api.listProjects = vi.fn(() =>
    Promise.resolve({data: [{id: '1', slug: 'api', name: 'API'}], nextCursor: null}),
  );
  api.getIssue = vi.fn(() => Promise.resolve({id: '42', title: 'Failure'}));
  let locked = false;
  const withRefreshLock = async <T>(
    _connectionId: string,
    fn: () => Promise<T>,
  ): Promise<{acquired: true; value: T} | {acquired: false}> => {
    if (locked) return {acquired: false};
    locked = true;
    try {
      return {acquired: true, value: await fn()};
    } finally {
      locked = false;
    }
  };
  const createClient = () =>
    createSentryReadClient({
      api,
      secrets,
      withRefreshLock,
      resolveConnection: async () => ({workspaceId}),
      getInstallation: async () => installation,
    });
  return {api, values, createClient, installation};
}

describe('createSentryReadClient', () => {
  it('builds source links from the installed connection identity', async () => {
    const {createClient, installation} = setup();
    installation.orgSlug = 'acme/team';
    const client = createClient();

    await expect(client.sourceUrl(connectionId, 'projects')).resolves.toBe(
      'https://sentry.io/organizations/acme%2Fteam/projects/',
    );
    await expect(client.sourceUrl(connectionId, 'issues', '42/other')).resolves.toBe(
      'https://sentry.io/organizations/acme%2Fteam/issues/42%2Fother/',
    );
  });

  it('reuses a shared token until its expiry margin', async () => {
    const {api, values, createClient} = setup();
    const namespace = sentrySecretsNamespace(connectionId);
    values.set(`${namespace}/ACCESS_TOKEN`, 'stored-token');
    values.set(`${namespace}/EXPIRES_AT`, new Date(Date.now() + 6 * 60 * 1000).toISOString());
    const client = createClient();

    await client.listProjects({connectionId});
    expect(api.mintInstallationToken).not.toHaveBeenCalled();
    expect(api.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({orgSlug: 'acme', token: 'stored-token'}),
    );

    values.set(`${namespace}/EXPIRES_AT`, new Date(Date.now() + 4 * 60 * 1000).toISOString());
    await client.listProjects({connectionId});
    expect(api.mintInstallationToken).toHaveBeenCalledTimes(1);
    expect(values.get(`${namespace}/ACCESS_TOKEN`)).toBe('new-token');
  });

  it('shares a concurrent mint across client instances', async () => {
    const {api, createClient} = setup();
    const [first, second] = await Promise.all([
      createClient().listProjects({connectionId}),
      createClient().listProjects({connectionId}),
    ]);

    expect(first.data).toHaveLength(1);
    expect(second.data).toHaveLength(1);
    expect(api.mintInstallationToken).toHaveBeenCalledTimes(1);
  });

  it('renews after a 401 and retries the read once', async () => {
    const {api, values, createClient} = setup();
    const namespace = sentrySecretsNamespace(connectionId);
    values.set(`${namespace}/ACCESS_TOKEN`, 'rejected-token');
    values.set(`${namespace}/EXPIRES_AT`, new Date(Date.now() + 60 * 60 * 1000).toISOString());
    vi.mocked(api.getIssue)
      .mockRejectedValueOnce(
        new SentryIntegrationProviderError('credentials-unavailable', 'expired', undefined, 401),
      )
      .mockResolvedValueOnce({id: '42', title: 'Failure'});

    expect(await createClient().getIssue({connectionId, issueId: '42'})).toEqual({
      id: '42',
      title: 'Failure',
    });
    expect(api.mintInstallationToken).toHaveBeenCalledTimes(1);
    expect(api.getIssue).toHaveBeenNthCalledWith(2, expect.objectContaining({token: 'new-token'}));
  });

  it('stops after a second 401', async () => {
    const {api, createClient} = setup();
    vi.mocked(api.getIssue).mockRejectedValue(
      new SentryIntegrationProviderError('credentials-unavailable', 'expired', undefined, 401),
    );

    await expect(createClient().getIssue({connectionId, issueId: '42'})).rejects.toMatchObject({
      reason: 'credentials-unavailable',
    });
    expect(api.getIssue).toHaveBeenCalledTimes(2);
    expect(api.mintInstallationToken).toHaveBeenCalledTimes(2);
  });

  it('does not save a token when minting fails', async () => {
    const {api, values, createClient} = setup();
    vi.mocked(api.mintInstallationToken).mockRejectedValue(
      new SentryIntegrationProviderError('access-denied', 'Sentry authorization rejected'),
    );

    await expect(createClient().listProjects({connectionId})).rejects.toMatchObject({
      reason: 'access-denied',
    });
    expect(values.size).toBe(0);
  });

  it('rejects a deleted installation before requesting credentials', async () => {
    const {api, createClient, installation} = setup();
    installation.status = 'deleted';

    await expect(createClient().listProjects({connectionId})).rejects.toMatchObject({
      reason: 'credentials-unavailable',
    });
    expect(api.mintInstallationToken).not.toHaveBeenCalled();
  });
});
