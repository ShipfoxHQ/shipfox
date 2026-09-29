import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GithubApiClient} from '#api/client.js';
import type {ConnectGithubInstallationInput} from './connection.js';
import {
  GithubLinkStateActorMismatchError,
  GithubLinkStateError,
  GithubMultipleLinkableInstallationsError,
  GithubNoLinkableInstallationError,
} from './errors.js';
import {handleGithubLinkCallback} from './link.js';
import {createGithubLinkState, signGithubInstallState} from './state.js';

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
    listUserInstallations: vi.fn(() => Promise.resolve({installationIds: [123], nextCursor: null})),
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
        .mockResolvedValueOnce({installationIds: [999], nextCursor: 'page-2'})
        .mockResolvedValueOnce({installationIds: [123], nextCursor: null}),
    });
    params.getExistingGithubConnection = vi.fn(({installationId}: {installationId: string}) =>
      Promise.resolve(
        installationId === '999' ? githubConnection(crypto.randomUUID(), '999') : undefined,
      ),
    ) as unknown as typeof params.getExistingGithubConnection;

    const result = await handleGithubLinkCallback(params);

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

    const result = await handleGithubLinkCallback(params);

    expect(result).not.toBe(existing);
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
      listUserInstallations: vi.fn(() =>
        Promise.resolve({installationIds: [123, 456], nextCursor: null}),
      ),
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

  it('rejects several unlinked candidates until selection support lands', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const params = baseParams(workspaceId, userId, stateFor(workspaceId, userId).state);
    params.github = githubClient({
      listUserInstallations: vi.fn(() =>
        Promise.resolve({installationIds: [123, 456], nextCursor: null}),
      ),
    });

    await expect(handleGithubLinkCallback(params)).rejects.toBeInstanceOf(
      GithubMultipleLinkableInstallationsError,
    );
    expect(params.github.getInstallation).not.toHaveBeenCalled();
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
