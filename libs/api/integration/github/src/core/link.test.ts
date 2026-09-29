import {GITHUB_LINK_SELECTION_MAX_CANDIDATES} from '@shipfox/api-integration-github-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GithubApiClient} from '#api/client.js';
import {githubUserInstallationPage} from '#test/index.js';
import type {ConnectGithubInstallationInput} from './connection.js';
import {
  GithubInstallationAlreadyLinkedError,
  GithubInstallationNotAuthorizedError,
  GithubInstallationSuspendedError,
  GithubIntegrationProviderError,
  GithubLinkSelectionError,
  GithubLinkStateActorMismatchError,
  GithubLinkStateError,
  GithubNoLinkableInstallationError,
  GithubTooManyLinkableInstallationsError,
} from './errors.js';
import {
  type GithubLinkSelection,
  handleGithubLinkCallback,
  handleGithubLinkSelection,
} from './link.js';
import {
  createGithubLinkState,
  signGithubInstallState,
  signGithubLinkSelection,
  verifyGithubLinkSelection,
} from './state.js';

function githubConnection(
  workspaceId: string,
  installationId: string,
): IntegrationConnection<'github'> {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    provider: 'github',
    externalAccountId: installationId,
    slug: 'github_account',
    displayName: 'GitHub account',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function githubClient(overrides: Partial<GithubApiClient> = {}): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.resolve('discarded-user-token')),
    listUserInstallations: vi.fn(() => Promise.resolve(githubUserInstallationPage([123]))),
    getInstallation: vi.fn(() =>
      Promise.resolve({
        id: 123,
        account: {login: 'shipfox', type: 'Organization'},
        repositorySelection: 'all',
        suspendedAt: null,
        htmlUrl: 'https://github.com/apps/shipfox/installations/123',
        raw: {id: 123},
      }),
    ),
    listInstallationRepositories: vi.fn(() =>
      Promise.resolve({repositories: [], nextCursor: null}),
    ),
    getRepository: vi.fn(),
    listRepositoryFiles: vi.fn(() => Promise.resolve({files: [], nextCursor: null})),
    fetchRepositoryFile: vi.fn(),
    listRepositoryCommits: vi.fn(),
    createInstallationAccessToken: vi.fn(),
    ...overrides,
  };
}

function stateFor(workspaceId: string, userId: string, now = new Date()) {
  return createGithubLinkState({workspaceId, userId, now});
}

function baseParams(workspaceId: string, userId: string, state: string) {
  return {
    github: githubClient(),
    code: 'oauth-code',
    state,
    sessionUserId: userId,
    sessionMemberships: [],
    requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
    getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
    connectGithubInstallation: vi.fn((input: ConnectGithubInstallationInput) =>
      Promise.resolve(githubConnection(input.workspaceId, input.installationId)),
    ),
    workspaceId,
  };
}

function asConnection(
  result: IntegrationConnection<'github'> | GithubLinkSelection,
): IntegrationConnection<'github'> {
  if ('selectionToken' in result) throw new Error('Expected a connection, got a selection');
  return result;
}

function asSelection(
  result: IntegrationConnection<'github'> | GithubLinkSelection,
): GithubLinkSelection {
  if (!('selectionToken' in result)) throw new Error('Expected a selection, got a connection');
  return result;
}

describe('handleGithubLinkCallback', () => {
  it('exchanges PKCE, pages installations, and connects one candidate', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const linkState = stateFor(workspaceId, userId);
    const params = baseParams(workspaceId, userId, linkState.state);
    params.github = githubClient({
      exchangeOAuthCode: vi.fn(() => Promise.resolve('discarded-user-token')),
      listUserInstallations: vi
        .fn()
        .mockResolvedValueOnce(githubUserInstallationPage([999], 'page-2'))
        .mockResolvedValueOnce(githubUserInstallationPage([123])),
    });
    params.getExistingGithubConnection = vi.fn(({installationId}: {installationId: string}) =>
      Promise.resolve(
        installationId === '999' ? githubConnection(crypto.randomUUID(), '999') : undefined,
      ),
    ) as unknown as typeof params.getExistingGithubConnection;

    const result = asConnection(await handleGithubLinkCallback(params));

    expect(result.externalAccountId).toBe('123');
    expect(params.github.exchangeOAuthCode).toHaveBeenCalledWith(
      'oauth-code',
      linkState.codeVerifier,
    );
    expect(params.github.listUserInstallations).toHaveBeenCalledTimes(2);
    expect(params.github.getInstallation).toHaveBeenCalledWith(123);
    expect(params.connectGithubInstallation).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId, installationId: '123', actorUserId: userId}),
    );
  });

  it('returns a same-workspace connection after checking accessible installations', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const existing = githubConnection(workspaceId, '123');
    const params = baseParams(workspaceId, userId, stateFor(workspaceId, userId).state);
    params.getExistingGithubConnection = vi.fn(() =>
      Promise.resolve(existing),
    ) as unknown as typeof params.getExistingGithubConnection;

    const result = await handleGithubLinkCallback(params);

    expect(result).toBe(existing);
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('reconnects a same-workspace connection when it is not active', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const existing = githubConnection(workspaceId, '123');
    existing.lifecycleStatus = 'disabled';
    const params = baseParams(workspaceId, userId, stateFor(workspaceId, userId).state);
    params.getExistingGithubConnection = vi.fn(() =>
      Promise.resolve(existing),
    ) as unknown as typeof params.getExistingGithubConnection;
    params.connectGithubInstallation = vi.fn(() =>
      Promise.resolve({...existing, lifecycleStatus: 'active'}),
    ) as unknown as typeof params.connectGithubInstallation;

    const result = asConnection(await handleGithubLinkCallback(params));

    expect(result.id).toBe(existing.id);
    expect(result.externalAccountId).toBe(existing.externalAccountId);
    expect(result.slug).toBe(existing.slug);
    expect(result.lifecycleStatus).toBe('active');
    expect(params.github.getInstallation).toHaveBeenCalledWith(123);
    expect(params.connectGithubInstallation).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId, installationId: '123', actorUserId: userId}),
    );
  });

  it('reports accessible and elsewhere-linked counts when no candidate remains', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const params = baseParams(workspaceId, userId, stateFor(workspaceId, userId).state);
    params.github = githubClient({
      listUserInstallations: vi.fn(() => Promise.resolve(githubUserInstallationPage([123, 456]))),
    });
    params.getExistingGithubConnection = vi.fn(({installationId}: {installationId: string}) =>
      Promise.resolve(githubConnection(crypto.randomUUID(), installationId)),
    ) as unknown as typeof params.getExistingGithubConnection;

    const result = handleGithubLinkCallback(params);
    await expect(result).rejects.toEqual(
      expect.objectContaining({
        accessible: 2,
        linkedElsewhere: 2,
      }),
    );
    await expect(result).rejects.toBeInstanceOf(GithubNoLinkableInstallationError);
  });

  it('returns several unlinked candidates with a selection token bound to them', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const params = baseParams(workspaceId, userId, stateFor(workspaceId, userId).state);
    params.github = githubClient({
      listUserInstallations: vi.fn(() => Promise.resolve(githubUserInstallationPage([123, 456]))),
    });

    const result = asSelection(await handleGithubLinkCallback(params));

    expect(result.candidates.map(({id}) => id)).toEqual([123, 456]);
    expect(result.candidates[0]?.account).toEqual({login: 'account-123', type: 'Organization'});
    expect(verifyGithubLinkSelection(result.selectionToken)).toEqual({
      workspaceId,
      userId,
      installationIds: [123, 456],
    });
    expect(params.github.getInstallation).not.toHaveBeenCalled();
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('rejects more candidates than the picker shows', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const params = baseParams(workspaceId, userId, stateFor(workspaceId, userId).state);
    const ids = Array.from({length: GITHUB_LINK_SELECTION_MAX_CANDIDATES + 1}, (_, i) => i + 1);
    params.github = githubClient({
      listUserInstallations: vi.fn(() => Promise.resolve(githubUserInstallationPage(ids))),
    });

    const result = handleGithubLinkCallback(params);

    await expect(result).rejects.toBeInstanceOf(GithubTooManyLinkableInstallationsError);
    await expect(result).rejects.toMatchObject({count: GITHUB_LINK_SELECTION_MAX_CANDIDATES + 1});
  });

  it('binds completion to the actor and link purpose before exchanging code', async () => {
    const workspaceId = crypto.randomUUID();
    const state = stateFor(workspaceId, crypto.randomUUID());
    const params = baseParams(workspaceId, crypto.randomUUID(), state.state);

    await expect(handleGithubLinkCallback(params)).rejects.toBeInstanceOf(
      GithubLinkStateActorMismatchError,
    );
    expect(params.github.exchangeOAuthCode).not.toHaveBeenCalled();

    const installState = signGithubInstallState({
      workspaceId,
      userId: params.sessionUserId,
    });
    await expect(handleGithubLinkCallback({...params, state: installState})).rejects.toBeInstanceOf(
      GithubLinkStateError,
    );
  });

  it('rejects expired link state', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const state = stateFor(workspaceId, userId, new Date(Date.now() - 60 * 60 * 1000));
    const params = baseParams(workspaceId, userId, state.state);

    await expect(handleGithubLinkCallback(params)).rejects.toBeInstanceOf(GithubLinkStateError);
  });
});

describe('handleGithubLinkSelection', () => {
  function selectionParams({
    workspaceId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    installationIds = [123, 456],
    installationId = 123,
    issuedAt = new Date(),
  }: {
    workspaceId?: string;
    userId?: string;
    installationIds?: number[];
    installationId?: number;
    issuedAt?: Date;
  } = {}) {
    const {code: _code, state: _state, ...rest} = baseParams(workspaceId, userId, '');
    return {
      ...rest,
      selectionToken: signGithubLinkSelection({
        workspaceId,
        userId,
        installationIds,
        now: issuedAt,
      }),
      installationId,
    };
  }

  it('links the selected installation through the app-authenticated lookup', async () => {
    const params = selectionParams();

    const result = await handleGithubLinkSelection(params);

    expect(result.externalAccountId).toBe('123');
    expect(params.requireWorkspaceMembership).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId: params.workspaceId}),
    );
    expect(params.github.getInstallation).toHaveBeenCalledWith(123);
    expect(params.github.exchangeOAuthCode).not.toHaveBeenCalled();
    expect(params.github.listUserInstallations).not.toHaveBeenCalled();
    expect(params.connectGithubInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: params.workspaceId,
        installationId: '123',
        actorUserId: params.sessionUserId,
      }),
    );
  });

  it('rejects a tampered token before any lookup', async () => {
    const params = selectionParams();
    const [payload, signature] = params.selectionToken.split('.');
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({...claims, installationIds: [123, 456, 789]}));
    const tampered = `${forged.toString('base64url')}.${signature}`;

    await expect(
      handleGithubLinkSelection({...params, selectionToken: tampered, installationId: 789}),
    ).rejects.toBeInstanceOf(GithubLinkSelectionError);
    expect(params.github.getInstallation).not.toHaveBeenCalled();
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('rejects a token issued to another actor', async () => {
    const params = selectionParams();

    await expect(
      handleGithubLinkSelection({...params, sessionUserId: crypto.randomUUID()}),
    ).rejects.toBeInstanceOf(GithubLinkStateActorMismatchError);
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('rejects the token workspace when the actor lost membership', async () => {
    const params = selectionParams();
    params.requireWorkspaceMembership = vi.fn(() =>
      Promise.reject(new Error('membership-required')),
    );

    await expect(handleGithubLinkSelection(params)).rejects.toThrow('membership-required');
    expect(params.github.getInstallation).not.toHaveBeenCalled();
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('rejects an installation id the token does not allow', async () => {
    const params = selectionParams({installationId: 789});

    await expect(handleGithubLinkSelection(params)).rejects.toBeInstanceOf(
      GithubInstallationNotAuthorizedError,
    );
    expect(params.github.getInstallation).not.toHaveBeenCalled();
  });

  it('rejects a suspended installation', async () => {
    const params = selectionParams();
    params.github = githubClient({
      getInstallation: vi.fn(() =>
        Promise.resolve({
          id: 123,
          account: {login: 'shipfox', type: 'Organization'},
          repositorySelection: 'all',
          suspendedAt: new Date(),
          htmlUrl: 'https://github.com/apps/shipfox/installations/123',
          raw: {id: 123},
        }),
      ),
    });

    await expect(handleGithubLinkSelection(params)).rejects.toBeInstanceOf(
      GithubInstallationSuspendedError,
    );
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('rejects a deleted installation', async () => {
    const params = selectionParams();
    params.github = githubClient({
      getInstallation: vi.fn(() =>
        Promise.reject(new GithubIntegrationProviderError('installation-not-found', 'Not Found')),
      ),
    });

    await expect(handleGithubLinkSelection(params)).rejects.toBeInstanceOf(
      GithubIntegrationProviderError,
    );
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('never repoints an installation linked to another workspace', async () => {
    const params = selectionParams();
    params.getExistingGithubConnection = vi.fn(() =>
      Promise.resolve(githubConnection(crypto.randomUUID(), '123')),
    ) as unknown as typeof params.getExistingGithubConnection;

    await expect(handleGithubLinkSelection(params)).rejects.toBeInstanceOf(
      GithubInstallationAlreadyLinkedError,
    );
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('returns the existing connection when the same selection is replayed', async () => {
    const params = selectionParams();
    const existing = githubConnection(params.workspaceId, '123');
    params.getExistingGithubConnection = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(existing);
    params.connectGithubInstallation = vi.fn(() => Promise.resolve(existing));

    const first = await handleGithubLinkSelection(params);
    const replayed = await handleGithubLinkSelection(params);

    expect(first).toBe(existing);
    expect(replayed).toBe(existing);
    expect(params.connectGithubInstallation).toHaveBeenCalledTimes(1);
  });

  it('recovers a lost selection with a fresh link completion', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const complete = baseParams(workspaceId, userId, stateFor(workspaceId, userId).state);
    complete.github = githubClient({
      listUserInstallations: vi.fn(() => Promise.resolve(githubUserInstallationPage([123, 456]))),
      getInstallation: vi.fn((id: number) =>
        Promise.resolve({
          id,
          account: {login: `account-${id}`, type: 'Organization'},
          repositorySelection: 'all',
          suspendedAt: null,
          htmlUrl: `https://github.com/apps/shipfox/installations/${id}`,
          raw: {id},
        }),
      ),
    });

    const fresh = asSelection(await handleGithubLinkCallback(complete));
    const result = await handleGithubLinkSelection({
      ...complete,
      selectionToken: fresh.selectionToken,
      installationId: 456,
    });

    expect(result.externalAccountId).toBe('456');
  });

  it('still links up to five minutes after issuance without rechecking GitHub user access', async () => {
    // Documented bound: selection trusts the access proven at issuance. A user
    // whose GitHub access was revoked meanwhile can still link until expiry.
    const issuedAt = new Date('2026-09-29T12:00:00.000Z');
    const params = selectionParams({issuedAt});
    params.github = githubClient({
      listUserInstallations: vi.fn(() => Promise.resolve(githubUserInstallationPage([]))),
    });

    const result = await handleGithubLinkSelection({
      ...params,
      now: new Date('2026-09-29T12:05:00.000Z'),
    });

    expect(result.externalAccountId).toBe('123');
    expect(params.github.listUserInstallations).not.toHaveBeenCalled();
    await expect(
      handleGithubLinkSelection({...params, now: new Date('2026-09-29T12:05:01.000Z')}),
    ).rejects.toThrow('Expired GitHub link selection');
  });
});
