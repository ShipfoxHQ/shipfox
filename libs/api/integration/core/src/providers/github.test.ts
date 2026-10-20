import {randomInt} from 'node:crypto';

import {INTEGRATION_CONNECTION_AVAILABLE} from '@shipfox/api-integration-core-dto';
import {sql} from 'drizzle-orm';

const captured = vi.hoisted(() => ({
  integrationProviderOptions: undefined as unknown,
  providerOptions: undefined as unknown,
}));

vi.mock('@shipfox/api-integration-github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/api-integration-github')>();
  const originalCreate = actual.createGithubInstallationTokenProvider;
  const originalCreateIntegrationProvider = actual.createGithubIntegrationProvider;

  return {
    ...actual,
    createGithubIntegrationProvider: vi.fn(
      (options: Parameters<typeof originalCreateIntegrationProvider>[0]) => {
        captured.integrationProviderOptions = options;
        return originalCreateIntegrationProvider(options);
      },
    ),
    createGithubInstallationTokenProvider: vi.fn(
      (options: Parameters<typeof originalCreate>[0]) => {
        captured.providerOptions = options;
        return originalCreate(options);
      },
    ),
  };
});

import type {
  ConnectGithubInstallationInput,
  GithubCheckoutTokenCachePort,
  GithubCheckoutTokenScope,
} from '@shipfox/api-integration-github';
import {
  deleteGithubUnlinkedInstallationByInstallationId,
  encodeInstallationTokenEnvelope,
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  GITHUB_INSTALLATION_TOKEN_GENERATION_KEY,
  getGithubInstallationByInstallationId,
  githubInstallationTokenGenerationNamespace,
  githubInstallationTokenKey,
  githubInstallationTokenNamespace,
  upsertGithubInstallation,
  upsertGithubUnlinkedInstallation,
} from '@shipfox/api-integration-github';
import {updateIntegrationConnectionLifecycleStatus} from '#db/connections.js';
import {db} from '#db/db.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {githubProviderModule} from '#providers/github.js';
import {createTestApp, useIntegrationRouteTest} from '#test/route-utils.js';

const checkoutTokenStorageKeyPattern = /^CHECKOUT_TOKEN_V1_[A-F0-9]{64}$/u;

type SecretStore = {
  read: (workspaceId: string, installationId: number, key: string) => Promise<string | null>;
  write: (
    workspaceId: string,
    installationId: number,
    key: string,
    envelope: {token?: string; expiresAt?: Date},
  ) => Promise<void>;
  readGeneration?: (workspaceId: string, installationId: number) => Promise<string | null>;
  writeGeneration?: (
    workspaceId: string,
    installationId: number,
    generation: string,
  ) => Promise<void>;
};

describe('githubProviderModule', () => {
  const context = useIntegrationRouteTest();

  it('deletes the installation before reconnecting the same installation', async () => {
    const part = await githubProviderModule.load();
    const app = await createTestApp([part.provider]);
    const providerOptions = captured.integrationProviderOptions as {
      connectGithubInstallation: (input: ConnectGithubInstallationInput) => Promise<{id: string}>;
    };
    const installerUserId = crypto.randomUUID();
    const installation: ConnectGithubInstallationInput['installation'] = {
      installationId: String(randomInt(1_000_000, 9_999_999)),
      accountLogin: 'shipfox',
      accountType: 'Organization',
      accountId: '1001',
      repositorySelection: 'all',
      suspendedAt: null,
      deletedAt: null,
      latestEvent: {id: 'installation-created'},
      installerUserId,
    };
    const input: ConnectGithubInstallationInput = {
      workspaceId: context.workspaceId,
      installationId: installation.installationId,
      displayName: 'GitHub shipfox',
      installerUserId,
      installation,
    };

    const firstConnection = await providerOptions.connectGithubInstallation(input);
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${firstConnection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(deleteResponse.statusCode).toBe(204);
    const secondConnection = await providerOptions.connectGithubInstallation(input);

    expect(secondConnection.id).not.toBe(firstConnection.id);
    await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${secondConnection.id}`,
      headers: {authorization: 'Bearer user'},
    });
  });

  it.each([
    ['suspended', new Date('2026-10-20T09:00:00.000Z'), 'error'],
    ['not suspended', null, 'active'],
  ] as const)('connects an installation that is %s with status %s', async (_label, suspendedAt, status) => {
    const part = await githubProviderModule.load();
    await createTestApp([part.provider]);
    const providerOptions = captured.integrationProviderOptions as {
      connectGithubInstallation: (
        input: ConnectGithubInstallationInput,
      ) => Promise<{lifecycleStatus: string}>;
    };
    const installerUserId = crypto.randomUUID();
    const installationId = String(randomInt(1_000_000, 9_999_999));

    const connection = await providerOptions.connectGithubInstallation({
      workspaceId: context.workspaceId,
      installationId,
      displayName: 'GitHub shipfox',
      installerUserId,
      installation: {
        installationId,
        accountLogin: 'shipfox',
        accountType: 'Organization',
        accountId: '1001',
        repositorySelection: 'all',
        suspendedAt,
        deletedAt: null,
        latestEvent: {id: 'installation-created'},
        installerUserId,
      },
    });

    expect(connection.lifecycleStatus).toBe(status);
  });

  it.each([
    ['before', -60_000, 'error'],
    ['after', 60_000, 'active'],
  ] as const)('keeps a lifecycle write newer than a GitHub read observed %s it', async (_label, offsetMs, status) => {
    const part = await githubProviderModule.load();
    await createTestApp([part.provider]);
    const providerOptions = captured.integrationProviderOptions as {
      connectGithubInstallation: (
        input: ConnectGithubInstallationInput,
      ) => Promise<{id: string; lifecycleStatus: string}>;
    };
    const installerUserId = crypto.randomUUID();
    const installationId = String(randomInt(1_000_000, 9_999_999));
    const installation: ConnectGithubInstallationInput['installation'] = {
      installationId,
      accountLogin: 'shipfox',
      accountType: 'Organization',
      accountId: '1001',
      repositorySelection: 'all',
      suspendedAt: null,
      deletedAt: null,
      latestEvent: {id: 'installation-created'},
      installerUserId,
    };
    const input = {
      workspaceId: context.workspaceId,
      installationId,
      displayName: 'GitHub shipfox',
      installerUserId,
    };
    const first = await providerOptions.connectGithubInstallation({...input, installation});
    // A suspend webhook commits after the reconnect's GitHub read began.
    await upsertGithubInstallation({
      connectionId: first.id,
      ...installation,
      suspendedAt: new Date(),
    });

    const second = await providerOptions.connectGithubInstallation({
      ...input,
      installation: {...installation, observedAt: new Date(Date.now() + offsetMs)},
    });

    expect(second.lifecycleStatus).toBe(status);
    const stored = await getGithubInstallationByInstallationId(installationId);
    expect(stored?.suspendedAt === null).toBe(status === 'active');
  });

  it('uses the GitHub package contract for the shared installation-token envelope', async () => {
    const cachedEnvelope = '{"token":"ghs_cached"}';
    const getSecret = vi.fn();
    getSecret.mockResolvedValueOnce(cachedEnvelope).mockResolvedValueOnce(undefined);
    const setSecrets = vi.fn(() => Promise.resolve());
    const deleteSecrets = vi.fn(() => Promise.resolve(0));

    await githubProviderModule.load({
      secrets: {
        github: {getSecret, setSecrets, deleteSecrets},
        deleteSecrets,
      },
    });

    const providerOptions = captured.providerOptions;
    if (!providerOptions || typeof providerOptions !== 'object') {
      throw new Error('GitHub installation-token provider options were not captured');
    }
    const secretStore = (providerOptions as {secretStore?: SecretStore}).secretStore;
    if (!secretStore) throw new Error('GitHub installation-token secret store was not configured');

    const workspaceId = 'workspace-1';
    const installationId = 123;
    const namespace = githubInstallationTokenNamespace(installationId);
    const profileKey = githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT);
    const readHit = await secretStore.read(workspaceId, installationId, profileKey);
    const readMiss = await secretStore.read(workspaceId, installationId, profileKey);
    const envelope = {
      token: 'ghs_cached',
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    await secretStore.write(workspaceId, installationId, profileKey, envelope);

    expect(readHit).toBe(cachedEnvelope);
    expect(readMiss).toBeNull();
    expect(GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY).toBe('ENVELOPE');
    expect(getSecret).toHaveBeenNthCalledWith(1, {
      workspaceId,
      namespace,
      key: profileKey,
    });
    expect(getSecret).toHaveBeenNthCalledWith(2, {
      workspaceId,
      namespace,
      key: profileKey,
    });
    expect(setSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace,
      values: {
        [profileKey]: encodeInstallationTokenEnvelope(envelope),
      },
    });

    const generationNamespace = githubInstallationTokenGenerationNamespace(installationId);
    const readGeneration = secretStore.readGeneration;
    const writeGeneration = secretStore.writeGeneration;
    if (!readGeneration || !writeGeneration) throw new Error('Generation adapter is missing');
    getSecret.mockReset();
    getSecret.mockResolvedValueOnce('generation-1').mockResolvedValueOnce(undefined);
    setSecrets.mockReset();
    await expect(readGeneration(workspaceId, installationId)).resolves.toBe('generation-1');
    await writeGeneration(workspaceId, installationId, 'generation-2');
    expect(getSecret).toHaveBeenCalledWith({
      workspaceId,
      namespace: generationNamespace,
      key: GITHUB_INSTALLATION_TOKEN_GENERATION_KEY,
    });
    expect(setSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace: generationNamespace,
      values: {[GITHUB_INSTALLATION_TOKEN_GENERATION_KEY]: 'generation-2'},
    });
  });

  it('wires the exact-scope cache to the scoped GitHub Secrets adapter', async () => {
    const getSecret = vi.fn(() => Promise.resolve(null));
    const getSecretsByNamespace = vi.fn(() => Promise.resolve({}));
    const setSecrets = vi.fn(() => Promise.resolve());
    const scopedDeleteSecrets = vi.fn(() => Promise.resolve(1));
    const deleteSecrets = vi.fn(() => Promise.resolve(1));

    const part = await githubProviderModule.load({
      secrets: {
        github: {
          getSecret,
          getSecretsByNamespace,
          setSecrets,
          deleteSecrets: scopedDeleteSecrets,
        },
        deleteSecrets,
      },
    });
    expect(part.workers).toHaveLength(1);

    const providerOptions = captured.integrationProviderOptions;
    if (!providerOptions || typeof providerOptions !== 'object') {
      throw new Error('GitHub integration provider options were not captured');
    }
    const checkoutTokenCache = (
      providerOptions as {
        checkoutTokenCache?: GithubCheckoutTokenCachePort;
      }
    ).checkoutTokenCache;
    if (!checkoutTokenCache) throw new Error('Expected exact-scope cache');

    const providerInstance = 'provider-instance';
    const scope: GithubCheckoutTokenScope = {
      workspaceId: 'workspace-1',
      providerInstance,
      installationId: 123,
      repositoryId: 456,
      permissions: {contents: 'read'},
    };
    const mint = vi.fn(() =>
      Promise.resolve({
        token: 'ghs_checkout',
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      }),
    );
    await checkoutTokenCache.getOrMint(scope, mint);
    await checkoutTokenCache.getOrMint(scope, mint);

    expect(mint).toHaveBeenCalledOnce();
    const secretCalls = getSecret.mock.calls as unknown as Array<
      [{workspaceId: string; namespace: string; key: string}]
    >;
    const checkoutSecretCall = secretCalls.find(
      ([params]) => params.namespace === `system/github/checkout-token/${providerInstance}/123`,
    );
    expect(checkoutSecretCall?.[0]).toMatchObject({
      workspaceId: 'workspace-1',
      namespace: `system/github/checkout-token/${providerInstance}/123`,
      key: expect.stringMatching(checkoutTokenStorageKeyPattern),
    });
    expect(getSecretsByNamespace).not.toHaveBeenCalled();
    const setSecretsCalls = setSecrets.mock.calls as unknown as Array<[unknown]>;
    const setSecretsCall = setSecretsCalls.at(-1)?.[0] as
      | {workspaceId: string; namespace: string; values: Record<string, string>}
      | undefined;
    expect(setSecretsCall).toMatchObject({
      workspaceId: 'workspace-1',
      namespace: `system/github/checkout-token/${providerInstance}/123`,
    });
    const storageKeys = Object.keys(setSecretsCall?.values ?? {});
    expect(storageKeys).toHaveLength(1);
    expect(storageKeys[0]).toBe(checkoutSecretCall?.[0].key);
    expect(storageKeys[0]).toMatch(checkoutTokenStorageKeyPattern);
    expect(setSecretsCall?.values[storageKeys[0] ?? '']).toEqual(expect.any(String));

    await checkoutTokenCache.deleteInstallation?.('workspace-1', providerInstance, 123);

    expect(scopedDeleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: `system/github/checkout-token/${providerInstance}/123`,
    });
    expect(deleteSecrets).not.toHaveBeenCalled();
  });

  describe('reinstall', () => {
    type Connect = (input: ConnectGithubInstallationInput) => Promise<{
      id: string;
      slug: string;
      lifecycleStatus: string;
      externalAccountId: string;
    }>;

    async function setup() {
      const part = await githubProviderModule.load();
      await createTestApp([part.provider]);
      const options = captured.integrationProviderOptions as {connectGithubInstallation: Connect};
      const installerUserId = crypto.randomUUID();
      const accountId = String(randomInt(1_000_000, 9_999_999));

      function input(params: {
        installationId?: string;
        workspaceId?: string;
        accountType?: string;
        accountLogin?: string;
        accountId?: string;
        suspendedAt?: Date | null;
      }): ConnectGithubInstallationInput {
        const installationId = params.installationId ?? String(randomInt(1_000_000, 9_999_999));
        return {
          workspaceId: params.workspaceId ?? context.workspaceId,
          installationId,
          displayName: `GitHub ${params.accountLogin ?? 'shipfox'}`,
          installerUserId,
          installation: {
            installationId,
            accountLogin: params.accountLogin ?? 'shipfox',
            accountType: params.accountType ?? 'Organization',
            accountId: params.accountId ?? accountId,
            repositorySelection: 'selected',
            suspendedAt: params.suspendedAt ?? null,
            deletedAt: null,
            latestEvent: {id: installationId},
            installerUserId,
          },
        };
      }

      async function availableEvents(connectionId: string) {
        return await db()
          .select({payload: integrationsOutbox.payload})
          .from(integrationsOutbox)
          .where(
            sql`${integrationsOutbox.eventType} = ${INTEGRATION_CONNECTION_AVAILABLE} AND ${integrationsOutbox.payload}->>'connectionId' = ${connectionId}`,
          );
      }

      return {connect: options.connectGithubInstallation, input, availableEvents};
    }

    it('reattaches the connection to the new installation and removes the unlinked row', async () => {
      const {connect, input, availableEvents} = await setup();
      const first = await connect(input({accountLogin: 'shipfox'}));
      await upsertGithubInstallation({
        connectionId: first.id,
        ...input({installationId: first.externalAccountId}).installation,
        deletedAt: new Date(),
      });
      await updateIntegrationConnectionLifecycleStatus({id: first.id, lifecycleStatus: 'error'});
      const newInstallationId = String(randomInt(10_000_000, 99_999_999));
      await upsertGithubUnlinkedInstallation({
        installationId: newInstallationId,
        accountLogin: 'shipfox',
        accountType: 'Organization',
        repositorySelection: 'selected',
        lastAction: 'created',
      });

      const second = await connect(
        input({installationId: newInstallationId, accountLogin: 'shipfox-renamed'}),
      );

      expect(second.id).toBe(first.id);
      expect(second.slug).toBe(first.slug);
      expect(second.externalAccountId).toBe(newInstallationId);
      expect(second.lifecycleStatus).toBe('active');
      const stored = await getGithubInstallationByInstallationId(newInstallationId);
      expect(stored).toMatchObject({
        connectionId: first.id,
        accountLogin: 'shipfox-renamed',
        deletedAt: null,
      });
      expect(await getGithubInstallationByInstallationId(first.externalAccountId)).toBeUndefined();
      expect(await deleteGithubUnlinkedInstallationByInstallationId(newInstallationId)).toBe(false);
      const events = await availableEvents(first.id);
      expect(events).toHaveLength(2);
      expect(events.at(-1)?.payload).toMatchObject({provider: 'github', slug: first.slug});
    });

    it('reattaches when the old installation was never marked deleted and re-enables a disabled connection', async () => {
      const {connect, input} = await setup();
      const first = await connect(input({}));
      await updateIntegrationConnectionLifecycleStatus({id: first.id, lifecycleStatus: 'disabled'});

      const second = await connect(input({}));

      expect(second.id).toBe(first.id);
      expect(second.lifecycleStatus).toBe('active');
    });

    it('derives error when the reinstalled installation is suspended', async () => {
      const {connect, input} = await setup();
      const first = await connect(input({}));

      const second = await connect(input({suspendedAt: new Date()}));

      expect(second.id).toBe(first.id);
      expect(second.lifecycleStatus).toBe('error');
    });

    it('creates a new connection for another workspace', async () => {
      const {connect, input} = await setup();
      const first = await connect(input({}));

      const second = await connect(input({workspaceId: crypto.randomUUID()}));

      expect(second.id).not.toBe(first.id);
      expect(await getGithubInstallationByInstallationId(first.externalAccountId)).toMatchObject({
        connectionId: first.id,
      });
    });

    it('creates a new connection for another account type with the same account ID', async () => {
      const {connect, input} = await setup();
      const first = await connect(input({accountType: 'User'}));

      const second = await connect(input({accountType: 'Organization'}));

      expect(second.id).not.toBe(first.id);
    });
  });
});
