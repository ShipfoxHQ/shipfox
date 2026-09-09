import type {GetIntegrationConnectionByIdFn} from '@shipfox/api-integration-spi';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  GITHUB_STATEFUL_INSTALLATION_TOKEN,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
  githubInstallationFactory,
} from '#test/index.js';
import {
  encodeInstallationTokenEnvelope,
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_GENERATION_KEY,
  githubInstallationTokenKey,
} from './installation-token-envelope.js';
import {createGithubInstallationTokenProvider} from './installation-token-provider.js';
import type {
  InstallationTokenCache,
  InstallationTokenSecretStore,
} from './shared-installation-token-cache.js';

const GITHUB_INSTALLATION_TOKEN_PATTERN = /^ghs_[A-Za-z0-9._-]{36,}$/u;

const {appOptions, createInstallationAccessTokenMock, RequestErrorMock} = vi.hoisted(() => ({
  appOptions: [] as unknown[],
  createInstallationAccessTokenMock: vi.fn(),
  RequestErrorMock: class RequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  },
}));

vi.mock('octokit', () => ({
  App: class App {
    octokit = {
      rest: {apps: {createInstallationAccessToken: createInstallationAccessTokenMock}},
    };

    constructor(options: unknown) {
      appOptions.push(options);
    }
  },
  Octokit: {
    plugin() {
      return this;
    },
    defaults(options: unknown) {
      return {defaults: options};
    },
  },
  RequestError: RequestErrorMock,
}));

describe('GithubInstallationTokenProvider', () => {
  beforeEach(() => {
    appOptions.length = 0;
    createInstallationAccessTokenMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mints a full-grant installation token on a cache miss', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider();

    const result = await provider.getInstallationAccessToken(1);

    expect(result).toEqual({
      token: GITHUB_STATELESS_INSTALLATION_TOKEN,
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
    });
    expect(GITHUB_STATELESS_INSTALLATION_TOKEN).toMatch(GITHUB_INSTALLATION_TOKEN_PATTERN);
    expect(GITHUB_STATELESS_INSTALLATION_TOKEN.slice(4).split('.')).toHaveLength(3);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
    });
  });

  it('uses the compatibility identity at the shared-cache boundary', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const getOrMint = vi.fn((...args: Parameters<InstallationTokenCache['getOrMint']>) =>
      args[2](),
    );
    const provider = createGithubInstallationTokenProvider({cache: {getOrMint}});

    await provider.getInstallationAccessToken(1);

    expect(getOrMint).toHaveBeenCalledWith(
      1,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      expect.any(Function),
    );
  });

  it('passes through a stateful full-grant installation token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATEFUL_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider();

    const result = await provider.getInstallationAccessToken(1);

    expect(result.token).toBe(GITHUB_STATEFUL_INSTALLATION_TOKEN);
    expect(GITHUB_STATEFUL_INSTALLATION_TOKEN).not.toContain('.');
  });

  it('returns a cached token without a second mint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider();

    const first = await provider.getInstallationAccessToken(1);
    const second = await provider.getInstallationAccessToken(1);

    expect(first).toEqual(second);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to namespace deletion when the cache has no deletion operation', async () => {
    const cache = {getOrMint: vi.fn()};
    const provider = createGithubInstallationTokenProvider({cache});
    const deleteNamespace = vi.fn(() => Promise.resolve(2));

    const deleted = await provider.deleteInstallation?.(1, {deleteNamespace});

    expect(deleted).toBe(2);
    expect(deleteNamespace).toHaveBeenCalledWith(1);
  });

  it('retries an in-flight mint that crosses an invalidation epoch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    let resolveFirstMint: (value: {data: {token: string; expires_at: string}}) => void = () => {
      throw new Error('First mint promise was not initialized');
    };
    createInstallationAccessTokenMock
      .mockReturnValueOnce(
        new Promise<{data: {token: string; expires_at: string}}>((resolve) => {
          resolveFirstMint = resolve;
        }),
      )
      .mockResolvedValueOnce({
        data: {
          token: 'ghs_after_approval',
          expires_at: '2026-06-10T12:00:00.000Z',
        },
      });
    const provider = createGithubInstallationTokenProvider();

    const pending = provider.getInstallationAccessToken(1);
    await Promise.resolve();
    expect(createInstallationAccessTokenMock).toHaveBeenCalledOnce();
    await provider.deleteInstallation?.(1);
    resolveFirstMint({
      data: {
        token: 'ghs_before_approval',
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });

    await expect(pending).resolves.toMatchObject({token: 'ghs_after_approval'});
    await expect(provider.getInstallationAccessToken(1)).resolves.toMatchObject({
      token: 'ghs_after_approval',
    });
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['suspended', {suspendedAt: new Date()}],
    ['deleted', {deletedAt: new Date()}],
  ])('fails closed for %s installations before reading the cache', async (_state, state) => {
    const installationId = Math.floor(Math.random() * 1_000_000_000);
    await githubInstallationFactory.create({installationId: String(installationId), ...state});
    const provider = createGithubInstallationTokenProvider({
      getIntegrationConnectionById: vi.fn(),
    });

    await expect(provider.getInstallationAccessToken(installationId)).rejects.toMatchObject({
      reason: 'access-denied',
    });
    expect(createInstallationAccessTokenMock).not.toHaveBeenCalled();
  });

  it('isolates local tokens by installation identity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    createInstallationAccessTokenMock
      .mockResolvedValueOnce({
        data: {token: 'ghs_first_installation', expires_at: '2026-06-10T12:00:00.000Z'},
      })
      .mockResolvedValueOnce({
        data: {token: 'ghs_second_installation', expires_at: '2026-06-10T12:00:00.000Z'},
      });
    const provider = createGithubInstallationTokenProvider();

    const first = await provider.getInstallationAccessToken(1);
    const second = await provider.getInstallationAccessToken(2);
    const firstAgain = await provider.getInstallationAccessToken(1);

    expect(first.token).toBe('ghs_first_installation');
    expect(second.token).toBe('ghs_second_installation');
    expect(firstAgain.token).toBe('ghs_first_installation');
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(2);
    expect(createInstallationAccessTokenMock).toHaveBeenNthCalledWith(1, {
      installation_id: 1,
    });
    expect(createInstallationAccessTokenMock).toHaveBeenNthCalledWith(2, {
      installation_id: 2,
    });
  });

  it('mints a fresh token inside the expiry refresh margin', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
    createInstallationAccessTokenMock
      .mockResolvedValueOnce({
        data: {token: 'ghs_first', expires_at: '2026-06-10T12:10:00.000Z'},
      })
      .mockResolvedValueOnce({
        data: {token: 'ghs_second', expires_at: '2026-06-10T13:00:00.000Z'},
      });
    const provider = createGithubInstallationTokenProvider();

    const first = await provider.getInstallationAccessToken(1);
    vi.setSystemTime(new Date('2026-06-10T12:06:00.000Z'));
    const second = await provider.getInstallationAccessToken(1);

    expect(first.token).toBe('ghs_first');
    expect(second.token).toBe('ghs_second');
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent cold-cache mints for one installation', async () => {
    let resolveMint: (
      value: Awaited<ReturnType<typeof createInstallationAccessTokenMock>>,
    ) => void = (_value) => {
      throw new Error('Mint promise was not initialized');
    };
    createInstallationAccessTokenMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMint = resolve;
      }),
    );
    const provider = createGithubInstallationTokenProvider();

    const first = provider.getInstallationAccessToken(1);
    const second = provider.getInstallationAccessToken(1);
    resolveMint({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const results = await Promise.all([first, second]);

    expect(results).toEqual([
      {token: 'ghs_installationtoken', expiresAt: new Date('2026-06-10T12:00:00.000Z')},
      {token: 'ghs_installationtoken', expiresAt: new Date('2026-06-10T12:00:00.000Z')},
    ]);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('composes the RAM tier over the shared token cache', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    const installationId = Math.floor(Math.random() * 1_000_000_000);
    const connectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    await githubInstallationFactory.create({installationId: String(installationId), connectionId});
    const values = new Map<string, string>();
    let lockCalls = 0;
    function withLock<T>(
      _installationId: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ) {
      lockCalls += 1;
      return fn().then((value) => ({acquired: true as const, value}));
    }
    const getIntegrationConnectionById: GetIntegrationConnectionByIdFn = () =>
      Promise.resolve({
        id: connectionId,
        workspaceId,
        provider: 'github',
        externalAccountId: String(installationId),
        slug: 'github_shipfox',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        repositoryAccessMode: 'selected',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider({
      getIntegrationConnectionById,
      secretStore: {
        read: (readWorkspaceId, readInstallationId, key) =>
          Promise.resolve(values.get(`${readWorkspaceId}:${readInstallationId}:${key}`) ?? null),
        write: (writeWorkspaceId, writeInstallationId, key, envelope) => {
          values.set(
            `${writeWorkspaceId}:${writeInstallationId}:${key}`,
            encodeInstallationTokenEnvelope(envelope),
          );
          return Promise.resolve();
        },
      },
      withLock,
      now: () => new Date(),
    });

    const first = await provider.getInstallationAccessToken(installationId);
    const second = await provider.getInstallationAccessToken(installationId);

    expect(first).toEqual(second);
    expect(first.token).toBe(GITHUB_STATELESS_INSTALLATION_TOKEN);
    expect(
      values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain(GITHUB_STATELESS_INSTALLATION_TOKEN);
    expect(lockCalls).toBe(2);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates RAM entries on another replica after the shared generation changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    createInstallationAccessTokenMock
      .mockResolvedValueOnce({
        data: {token: 'ghs_before_approval', expires_at: '2026-06-10T12:00:00.000Z'},
      })
      .mockResolvedValueOnce({
        data: {token: 'ghs_after_approval', expires_at: '2026-06-10T12:00:00.000Z'},
      });
    const installationId = Math.floor(Math.random() * 1_000_000_000);
    const connectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const values = new Map<string, string>();
    const secretStore = {
      read: (readWorkspaceId: string, readInstallationId: number, key: string) =>
        Promise.resolve(values.get(`${readWorkspaceId}:${readInstallationId}:${key}`) ?? null),
      write: (
        writeWorkspaceId: string,
        writeInstallationId: number,
        key: string,
        envelope: Parameters<NonNullable<InstallationTokenSecretStore['write']>>[3],
      ) => {
        values.set(
          `${writeWorkspaceId}:${writeInstallationId}:${key}`,
          encodeInstallationTokenEnvelope(envelope),
        );
        return Promise.resolve();
      },
      readGeneration: (readWorkspaceId: string, readInstallationId: number) =>
        Promise.resolve(
          values.get(
            `${readWorkspaceId}:${readInstallationId}:${GITHUB_INSTALLATION_TOKEN_GENERATION_KEY}`,
          ) ?? null,
        ),
      writeGeneration: (
        writeWorkspaceId: string,
        writeInstallationId: number,
        generation: string,
      ) => {
        values.set(
          `${writeWorkspaceId}:${writeInstallationId}:${GITHUB_INSTALLATION_TOKEN_GENERATION_KEY}`,
          generation,
        );
        return Promise.resolve();
      },
    };
    await githubInstallationFactory.create({
      installationId: String(installationId),
      connectionId,
    });
    const getGithubInstallationByInstallationId = vi.fn(() =>
      Promise.resolve({
        connectionId,
        suspendedAt: null,
        deletedAt: null,
      } as never),
    );
    const getIntegrationConnectionById: GetIntegrationConnectionByIdFn = () =>
      Promise.resolve({
        id: connectionId,
        workspaceId,
        provider: 'github',
        externalAccountId: String(installationId),
        slug: 'github_shipfox',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        repositoryAccessMode: 'selected',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    const options = {
      getIntegrationConnectionById,
      getGithubInstallationByInstallationId,
      secretStore,
      withLock: <T>(_id: number, _profile: string, fn: () => Promise<T>) =>
        fn().then((value) => ({acquired: true as const, value})),
      now: () => new Date(),
    };
    const firstReplica = createGithubInstallationTokenProvider(options);
    const secondReplica = createGithubInstallationTokenProvider(options);

    await expect(firstReplica.getInstallationAccessToken(installationId)).resolves.toMatchObject({
      token: 'ghs_before_approval',
    });
    await expect(secondReplica.getInstallationAccessToken(installationId)).resolves.toMatchObject({
      token: 'ghs_before_approval',
    });
    await expect(
      firstReplica.deleteInstallation?.(installationId, {
        workspaceId,
        deleteNamespace: () => {
          values.clear();
          return Promise.resolve(1);
        },
      }),
    ).resolves.toBeGreaterThanOrEqual(1);

    await expect(secondReplica.getInstallationAccessToken(installationId)).resolves.toMatchObject({
      token: 'ghs_after_approval',
    });
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(2);
  });

  it('configures throttle retry handlers on the mint octokit', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const provider = createGithubInstallationTokenProvider();

    await provider.getInstallationAccessToken(1);

    expect(appOptions).toEqual([
      expect.objectContaining({
        Octokit: {
          defaults: {
            baseUrl: 'https://api.github.com',
            throttle: {
              onRateLimit: expect.any(Function),
              onSecondaryRateLimit: expect.any(Function),
            },
          },
        },
      }),
    ]);
  });

  it('maps missing installations to an installation-not-found provider error', async () => {
    createInstallationAccessTokenMock.mockRejectedValue(new RequestErrorMock('Not Found', 404));
    const provider = createGithubInstallationTokenProvider();

    const result = provider.getInstallationAccessToken(1);

    await expect(result).rejects.toMatchObject({
      reason: 'installation-not-found',
    });
  });

  it('rejects a response without a token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const provider = createGithubInstallationTokenProvider();

    const result = provider.getInstallationAccessToken(1);

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
    await expect(result).rejects.toBeInstanceOf(GithubIntegrationProviderError);
  });

  it('rejects a response with a missing or unparseable expiry', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken'},
    });
    const provider = createGithubInstallationTokenProvider();

    const result = provider.getInstallationAccessToken(1);

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
  });
});
