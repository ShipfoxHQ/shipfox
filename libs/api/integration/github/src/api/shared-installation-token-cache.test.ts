import {createHash} from 'node:crypto';
import {secretKeySchema} from '@shipfox/api-secrets-dto';
import {GithubIntegrationProviderError} from '#core/errors.js';
import type {GithubInstallationAccessToken} from './client.js';
import {
  backoffActive,
  encodeInstallationTokenEnvelope,
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  GITHUB_INSTALLATION_TOKEN_GENERATION_KEY,
  githubInstallationTokenBackoffKey,
  githubInstallationTokenKey,
  needsRefresh,
  stillValid,
  TOKEN_REFRESH_MARGIN_MS,
  TOKEN_VALIDITY_BUFFER_MS,
} from './installation-token-envelope.js';
import {
  type InstallationTokenLockResult,
  type InstallationTokenSecretStore,
  SharedInstallationTokenCache,
} from './shared-installation-token-cache.js';

const errorMonitoring = vi.hoisted(() => ({reportError: vi.fn()}));
vi.mock('@shipfox/node-error-monitoring', () => errorMonitoring);

const workspaceId = '00000000-0000-4000-8000-000000000001';
const installationId = 123;

function token(tokenValue: string, expiresAt = '2026-06-10T12:00:00.000Z') {
  return {token: tokenValue, expiresAt: new Date(expiresAt)};
}

function createStore(): InstallationTokenSecretStore & {
  values: Map<string, string>;
  failWrites: boolean;
  failReads: boolean;
  failGenerationReads: boolean;
  failGenerationWrites: boolean;
} {
  const values = new Map<string, string>();
  const store = {
    values,
    failWrites: false,
    failReads: false,
    failGenerationReads: false,
    failGenerationWrites: false,
    read(readWorkspaceId: string, readInstallationId: number, key: string) {
      if (!secretKeySchema.safeParse(key).success) {
        return Promise.reject(new Error(`invalid secret key: ${key}`));
      }
      if (store.failReads) return Promise.reject(new Error('read failed'));
      return Promise.resolve(values.get(`${readWorkspaceId}:${readInstallationId}:${key}`) ?? null);
    },
    write(
      writeWorkspaceId: string,
      writeInstallationId: number,
      key: string,
      envelope: Parameters<InstallationTokenSecretStore['write']>[3],
    ) {
      if (!secretKeySchema.safeParse(key).success) {
        return Promise.reject(new Error(`invalid secret key: ${key}`));
      }
      if (store.failWrites) return Promise.reject(new Error('write failed'));
      values.set(
        `${writeWorkspaceId}:${writeInstallationId}:${key}`,
        encodeInstallationTokenEnvelope(envelope),
      );
      return Promise.resolve();
    },
    readGeneration(readWorkspaceId: string, readInstallationId: number) {
      if (store.failGenerationReads) return Promise.reject(new Error('generation read failed'));
      return Promise.resolve(
        values.get(
          `${readWorkspaceId}:${readInstallationId}:${GITHUB_INSTALLATION_TOKEN_GENERATION_KEY}`,
        ) ?? null,
      );
    },
    writeGeneration(writeWorkspaceId: string, writeInstallationId: number, generation: string) {
      if (store.failGenerationWrites) return Promise.reject(new Error('generation write failed'));
      values.set(
        `${writeWorkspaceId}:${writeInstallationId}:${GITHUB_INSTALLATION_TOKEN_GENERATION_KEY}`,
        generation,
      );
      return Promise.resolve();
    },
  };
  return store;
}

function cache(
  options: {
    store?: InstallationTokenSecretStore | undefined;
    now?: Date | undefined;
    withLock?:
      | (<T>(
          installationId: number,
          permissionFingerprint: string,
          fn: () => Promise<T>,
        ) => Promise<InstallationTokenLockResult<T>>)
      | undefined;
    withBackoffLock?:
      | (<T>(
          installationId: number,
          permissionFingerprint: string,
          fn: () => Promise<T>,
        ) => Promise<InstallationTokenLockResult<T>>)
      | undefined;
    resolveWorkspaceId?: ((installationId: number) => Promise<string>) | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
    pollDelaysMs?: number[] | undefined;
  } = {},
) {
  return new SharedInstallationTokenCache({
    secretStore: options.store ?? createStore(),
    withLock:
      options.withLock ??
      (async (_id, _permissionFingerprint, fn) => ({acquired: true, value: await fn()})),
    withBackoffLock:
      options.withBackoffLock ??
      (async (_id, _permissionFingerprint, fn) => ({acquired: true, value: await fn()})),
    resolveWorkspaceId: options.resolveWorkspaceId ?? (() => Promise.resolve(workspaceId)),
    now: () => options.now ?? new Date('2026-06-10T11:00:00.000Z'),
    sleep: options.sleep ?? (() => Promise.resolve()),
    pollDelaysMs: options.pollDelaysMs ?? [],
  });
}

function setEnvelope(
  store: {values: Map<string, string>},
  envelope: Parameters<typeof encodeInstallationTokenEnvelope>[0],
  permissionFingerprint = GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
) {
  store.values.set(
    `${workspaceId}:${installationId}:${githubInstallationTokenKey(permissionFingerprint)}`,
    encodeInstallationTokenEnvelope(envelope),
  );
}

describe('SharedInstallationTokenCache', () => {
  it('does not collide raw and hashed permission fingerprints', () => {
    const rawFingerprint = 'profile-without-safe-key';
    const hashedFingerprint = createHash('sha256')
      .update(rawFingerprint, 'utf8')
      .digest('hex')
      .toUpperCase();

    expect(githubInstallationTokenKey(rawFingerprint)).not.toBe(
      githubInstallationTokenKey(hashedFingerprint),
    );
  });

  it('reads the fixed-key compatibility envelope without invalid secret reads', async () => {
    const store = createStore();
    store.values.set(
      `${workspaceId}:${installationId}:${GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY}`,
      encodeInstallationTokenEnvelope({
        backoffUntil: new Date('2026-06-10T11:05:00.000Z'),
        backoffReason: 'rate-limited',
        backoffError: {message: 'rate limited', status: 429},
      }),
    );
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({reason: 'rate-limited', status: 429});
    expect(mint).not.toHaveBeenCalled();
    expect(errorMonitoring.reportError).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    errorMonitoring.reportError.mockReset();
  });

  it('mints once on a cold winner miss and writes the secret envelope', async () => {
    const store = createStore();
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );

    expect(result).toEqual(token('ghs_new'));
    expect(mint).toHaveBeenCalledTimes(1);
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('ghs_new');
  });

  it('writes token and backoff envelopes under a caller-owned compatibility lock', async () => {
    const store = createStore();
    let lockHeld = false;
    const withNonReentrantLock = async <T>(
      _installationId: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ): Promise<InstallationTokenLockResult<T>> => {
      if (lockHeld) return {acquired: false};
      lockHeld = true;
      try {
        return {acquired: true, value: await fn()};
      } finally {
        lockHeld = false;
      }
    };
    const shared = cache({
      store,
      withLock: withNonReentrantLock,
      withBackoffLock: withNonReentrantLock,
    });

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).resolves.toEqual(token('ghs_new'));
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('ghs_new');

    setEnvelope(store, token('ghs_existing', '2026-06-10T11:04:30.000Z'));
    const failedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, failedMint),
    ).rejects.toMatchObject({reason: 'provider-rejected'});
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('provider-rejected');
  });

  it('rejects a legacy envelope after a new invalidation generation is published', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_before-approval'), 'broad');
    await store.writeGeneration?.(workspaceId, installationId, 'generation-after-approval');
    const mint = vi.fn(() => Promise.resolve(token('ghs_after-approval')));
    const shared = cache({store});

    await expect(shared.getOrMint(installationId, 'broad', mint)).resolves.toEqual(
      token('ghs_after-approval'),
    );
    expect(mint).toHaveBeenCalledOnce();
    expect(
      store.values.get(`${workspaceId}:${installationId}:${githubInstallationTokenKey('broad')}`),
    ).toContain('generation-after-approval');
  });

  it('fails closed when the generation fence cannot be read', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_stale'), 'broad');
    store.failGenerationReads = true;
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, 'broad', () => Promise.resolve(token('ghs_fresh'))),
    ).rejects.toMatchObject({reason: 'provider-unavailable'});
  });

  it('fences a mint that completes after installation invalidation', async () => {
    const store = createStore();
    let resolveFirstMint: (value: GithubInstallationAccessToken) => void = () => undefined;
    let resolveFirstMintStarted: () => void = () => undefined;
    const firstMintStarted = new Promise<void>((resolve) => {
      resolveFirstMintStarted = resolve;
    });
    let mintCalls = 0;
    const mint = vi.fn(() => {
      mintCalls += 1;
      if (mintCalls === 1) {
        resolveFirstMintStarted();
        return new Promise<GithubInstallationAccessToken>((resolve) => {
          resolveFirstMint = resolve;
        });
      }
      return Promise.resolve(token('ghs_fresh'));
    });
    const withLock = async <T>(
      _installationId: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ): Promise<InstallationTokenLockResult<T>> => ({
      acquired: true,
      value: await fn(),
    });
    const shared = cache({store, withLock});
    const pending = shared.getOrMint(installationId, 'broad', mint);
    await firstMintStarted;
    await shared.deleteInstallation(installationId, {
      workspaceId,
      deleteNamespace: () => {
        store.values.clear();
        return Promise.resolve(1);
      },
    });
    resolveFirstMint(token('ghs_stale'));

    await expect(pending).resolves.toEqual(token('ghs_fresh'));
    expect(mint).toHaveBeenCalledTimes(2);
    expect(store.values.get(`${workspaceId}:${installationId}:GENERATION`)).toBeDefined();
    expect(
      store.values.get(`${workspaceId}:${installationId}:${githubInstallationTokenKey('broad')}`),
    ).toContain('ghs_fresh');
  });

  it('keeps the invalidation fence after a failed cleanup and retries it', async () => {
    const store = createStore();
    const shared = cache({store});
    await shared.getOrMint(installationId, 'broad', () => Promise.resolve(token('ghs_old')));
    store.failGenerationWrites = true;

    await expect(
      shared.deleteInstallation(installationId, {
        workspaceId,
        deleteNamespace: () => {
          store.values.clear();
          return Promise.resolve(1);
        },
      }),
    ).rejects.toMatchObject({reason: 'provider-unavailable'});

    store.failGenerationWrites = false;
    await expect(
      shared.deleteInstallation(installationId, {
        workspaceId,
        deleteNamespace: () => {
          store.values.clear();
          return Promise.resolve(1);
        },
      }),
    ).resolves.toBe(1);
    await expect(
      shared.getOrMint(installationId, 'broad', () => Promise.resolve(token('ghs_new'))),
    ).resolves.toEqual(token('ghs_new'));
  });

  it('isolates profile tokens while allowing different profiles to mint independently', async () => {
    const store = createStore();
    const shared = cache({store});
    const broadMint = vi.fn(() => Promise.resolve(token('ghs_broad')));
    const narrowMint = vi.fn(() => Promise.resolve(token('ghs_narrow')));

    await expect(shared.getOrMint(installationId, 'broad', broadMint)).resolves.toEqual(
      token('ghs_broad'),
    );
    await expect(shared.getOrMint(installationId, 'narrow', narrowMint)).resolves.toEqual(
      token('ghs_narrow'),
    );
    await expect(shared.getOrMint(installationId, 'broad', broadMint)).resolves.toEqual(
      token('ghs_broad'),
    );
    await expect(shared.getOrMint(installationId, 'narrow', narrowMint)).resolves.toEqual(
      token('ghs_narrow'),
    );

    expect(broadMint).toHaveBeenCalledTimes(1);
    expect(narrowMint).toHaveBeenCalledTimes(1);
    expect(
      store.values.has(`${workspaceId}:${installationId}:${githubInstallationTokenKey('broad')}`),
    ).toBe(true);
    expect(
      store.values.has(`${workspaceId}:${installationId}:${githubInstallationTokenKey('narrow')}`),
    ).toBe(true);
  });

  it('isolates profile-specific backoff across permission profile keys', async () => {
    const store = createStore();
    const shared = cache({store});
    const failedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));
    const siblingMint = vi.fn(() => Promise.resolve(token('ghs_sibling')));

    await expect(shared.getOrMint(installationId, 'broad', failedMint)).rejects.toMatchObject({
      reason: 'provider-rejected',
    });
    await expect(shared.getOrMint(installationId, 'narrow', siblingMint)).resolves.toEqual(
      token('ghs_sibling'),
    );

    expect(failedMint).toHaveBeenCalledTimes(1);
    expect(siblingMint).toHaveBeenCalledTimes(1);
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('broad')}`,
      ),
    ).toContain('provider-rejected');
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('narrow')}`,
      ),
    ).toBe('{}');
  });

  it('shares installation-wide backoff across permission profile keys', async () => {
    const store = createStore();
    const lockFingerprints: string[] = [];
    const shared = cache({
      store,
      withLock: async <T>(
        _installationId: number,
        permissionFingerprint: string,
        fn: () => Promise<T>,
      ): Promise<InstallationTokenLockResult<T>> => {
        lockFingerprints.push(permissionFingerprint);
        return {acquired: true as const, value: await fn()};
      },
    });
    const failedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-unavailable', 'unavailable'));
    const siblingMint = vi.fn(() => Promise.resolve(token('ghs_sibling')));

    await expect(shared.getOrMint(installationId, 'broad', failedMint)).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
    await expect(shared.getOrMint(installationId, 'narrow', siblingMint)).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });

    expect(failedMint).toHaveBeenCalledTimes(1);
    expect(siblingMint).not.toHaveBeenCalled();
    expect(lockFingerprints).toContain(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT);
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('provider-unavailable');
  });

  it('preserves an active terminal backoff over a later transient backoff', async () => {
    const store = createStore();
    setEnvelope(
      store,
      {
        ...token('ghs_existing', '2026-06-10T11:04:30.000Z'),
      },
      'broad',
    );
    store.values.set(
      `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('broad')}`,
      encodeInstallationTokenEnvelope({
        backoffUntil: new Date('2026-06-10T11:10:00.000Z'),
        backoffReason: 'provider-rejected',
      }),
    );
    store.values.set(
      `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      encodeInstallationTokenEnvelope({
        backoffUntil: new Date('2026-06-10T11:15:00.000Z'),
        backoffReason: 'provider-unavailable',
      }),
    );
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    await expect(shared.getOrMint(installationId, 'broad', mint)).rejects.toMatchObject({
      reason: 'provider-rejected',
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it('shares one mint between two concurrent cache replicas', async () => {
    const store = createStore();
    let lockHeld = false;
    let releaseLock: () => void = () => undefined;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let resolveMintStarted: () => void = () => undefined;
    const mintStarted = new Promise<void>((resolve) => {
      resolveMintStarted = resolve;
    });
    const withLock = async <T>(
      _id: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ) => {
      if (lockHeld) return {acquired: false as const};
      lockHeld = true;
      try {
        return {acquired: true as const, value: await fn()};
      } finally {
        lockHeld = false;
        releaseLock();
      }
    };
    const mint = vi.fn(() => {
      resolveMintStarted();
      return Promise.resolve(token('ghs_shared'));
    });
    const firstReplica = cache({store, withLock});
    const secondReplica = cache({
      store,
      withLock,
      sleep: () => lockReleased,
      pollDelaysMs: [1],
    });

    const first = firstReplica.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );
    await mintStarted;
    const second = secondReplica.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );
    const results = await Promise.all([first, second]);

    expect(results).toEqual([token('ghs_shared'), token('ghs_shared')]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('returns a warm store hit without minting', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_cached'));
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );

    expect(result).toEqual(token('ghs_cached'));
    expect(mint).not.toHaveBeenCalled();
  });

  it('serves a same-generation cached hit without reacquiring the compatibility lock', async () => {
    const store = createStore();
    await store.writeGeneration?.(workspaceId, installationId, 'generation-1');
    setEnvelope(store, {...token('ghs_cached'), generation: 'generation-1'});
    const withBackoffLock = vi.fn(() => Promise.resolve({acquired: false as const}));
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store, withBackoffLock});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).resolves.toEqual(token('ghs_cached'));
    expect(mint).not.toHaveBeenCalled();
    expect(withBackoffLock).not.toHaveBeenCalled();
  });

  it('serves a still-valid token on a contended refresh path', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_stale_but_valid', '2026-06-10T11:04:30.000Z'));
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({
      store,
      withLock: () => Promise.resolve({acquired: false}),
    });

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );

    expect(result).toEqual(token('ghs_stale_but_valid', '2026-06-10T11:04:30.000Z'));
    expect(mint).not.toHaveBeenCalled();
  });

  it('polls for the winner commit on a contended cold miss', async () => {
    const store = createStore();
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    let polls = 0;
    const shared = cache({
      store,
      withLock: () => Promise.resolve({acquired: false}),
      pollDelaysMs: [1, 1],
      sleep: () => {
        polls += 1;
        if (polls === 1) setEnvelope(store, token('ghs_committed'));
        return Promise.resolve();
      },
    });

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );

    expect(result).toEqual(token('ghs_committed'));
    expect(mint).not.toHaveBeenCalled();
  });

  it('refreshes a near-expiry token and clears backoff', async () => {
    const store = createStore();
    setEnvelope(store, {
      ...token('ghs_old', '2026-06-10T11:04:00.000Z'),
      backoffUntil: new Date('2026-06-10T10:00:00.000Z'),
      backoffReason: 'rate-limited',
    });
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.resolve(token('ghs_new')),
    );

    expect(result).toEqual(token('ghs_new'));
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).not.toContain('backoff');
  });

  it('records transient backoff and short-circuits the next call with the stored reason', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('rate-limited', 'rate limited', 42));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'rate-limited',
    });
    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'rate-limited',
      retryAfterSeconds: 42,
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('records terminal backoff without hiding access denied as provider unavailable', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('access-denied', 'denied'));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'access-denied',
    });
    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'access-denied',
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('preserves terminal provider rejection details through backoff', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockRejectedValue(
        new GithubIntegrationProviderError(
          'provider-rejected',
          'commit_id is missing',
          undefined,
          422,
        ),
      );
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'commit_id is missing',
      status: 422,
    });
    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'commit_id is missing',
      status: 422,
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('serves stale when refresh minting fails while the token is still valid', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_existing', '2026-06-10T11:04:30.000Z'));
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.reject(new GithubIntegrationProviderError('provider-unavailable', 'down')),
    );

    expect(result).toEqual(token('ghs_existing', '2026-06-10T11:04:30.000Z'));
  });

  it('does not serve stale when refresh minting fails with a terminal reason', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_existing', '2026-06-10T11:04:30.000Z'));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.reject(new GithubIntegrationProviderError('access-denied', 'denied')),
      ),
    ).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('does not serve stale from active terminal backoff on a contended refresh', async () => {
    const store = createStore();
    setEnvelope(store, {
      ...token('ghs_existing', '2026-06-10T11:04:30.000Z'),
      backoffUntil: new Date('2026-06-10T11:15:00.000Z'),
      backoffReason: 'installation-not-found',
    });
    const shared = cache({
      store,
      withLock: () => Promise.resolve({acquired: false}),
    });

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).rejects.toMatchObject({reason: 'installation-not-found'});
  });

  it('returns a minted token when the cache read fails', async () => {
    const store = createStore();
    store.failReads = true;
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.resolve(token('ghs_new')),
    );

    expect(result).toEqual(token('ghs_new'));
  });

  it('reports one read failure across a contended poll', async () => {
    const store = createStore();
    store.failReads = true;
    const shared = cache({
      store,
      withLock: () => Promise.resolve({acquired: false}),
      pollDelaysMs: [1],
    });

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).rejects.toMatchObject({reason: 'provider-unavailable'});

    expect(errorMonitoring.reportError).toHaveBeenCalledTimes(1);
  });

  it('returns a minted token when the cache write fails', async () => {
    const store = createStore();
    store.failWrites = true;
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.resolve(token('ghs_new')),
    );

    expect(result).toEqual(token('ghs_new'));
  });

  it('treats an invalid envelope as a miss and overwrites it', async () => {
    const store = createStore();
    store.values.set(
      `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      '{bad json',
    );
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.resolve(token('ghs_new')),
    );

    expect(result).toEqual(token('ghs_new'));
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('ghs_new');
  });

  it('surfaces an unresolvable installation as installation-not-found', async () => {
    const shared = cache({
      resolveWorkspaceId: () =>
        Promise.reject(new GithubIntegrationProviderError('installation-not-found', 'missing')),
    });

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).rejects.toMatchObject({reason: 'installation-not-found'});
  });
});

describe('installation token envelope predicates', () => {
  it('uses exact refresh, validity, and backoff boundaries', () => {
    const now = new Date('2026-06-10T11:00:00.000Z');

    expect(needsRefresh(new Date(now.getTime() + TOKEN_REFRESH_MARGIN_MS), now)).toBe(true);
    expect(needsRefresh(new Date(now.getTime() + TOKEN_REFRESH_MARGIN_MS + 1), now)).toBe(false);
    expect(stillValid(new Date(now.getTime() + TOKEN_VALIDITY_BUFFER_MS), now)).toBe(false);
    expect(stillValid(new Date(now.getTime() + TOKEN_VALIDITY_BUFFER_MS + 1), now)).toBe(true);
    expect(
      backoffActive(
        {
          backoffUntil: now,
          backoffReason: 'provider-unavailable',
        },
        now,
      ),
    ).toBe(false);
    expect(
      backoffActive(
        {
          backoffUntil: new Date(now.getTime() + 1),
          backoffReason: 'provider-unavailable',
        },
        now,
      ),
    ).toBe(true);
  });
});
