import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {
  type ConnectGithubInteractionParams,
  connectGithubInteraction,
  type GithubInstallInteraction,
} from './connection.js';
import {
  GithubInstallationAlreadyLinkedError,
  GithubInstallationNotAuthorizedError,
  GithubInstallStateActorMismatchError,
} from './errors.js';

function githubConnection(
  overrides: Partial<IntegrationConnection<'github'>> = {},
): IntegrationConnection<'github'> {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'github',
    externalAccountId: '123',
    slug: 'github_shipfox',
    displayName: 'GitHub shipfox',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    repositoryAccessMode: 'selected',
    ...overrides,
  };
}

function installInteraction(
  overrides: Partial<GithubInstallInteraction> = {},
): GithubInstallInteraction {
  return {
    kind: 'install',
    actorUserId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    installationId: 123,
    ...overrides,
  };
}

function connectionParams(interaction = installInteraction()): ConnectGithubInteractionParams & {
  acquireInstallationProof: ReturnType<typeof vi.fn>;
  connectGithubInstallation: ReturnType<typeof vi.fn>;
  getExistingGithubConnection: ReturnType<typeof vi.fn>;
  requireWorkspaceMembership: ReturnType<typeof vi.fn>;
} {
  return {
    interaction,
    sessionUserId: interaction.actorUserId,
    sessionMemberships: [],
    requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
    getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
    acquireInstallationProof: vi.fn(() =>
      Promise.resolve({
        installation: {
          id: interaction.installationId,
          account: {login: 'shipfox', type: 'Organization'},
          repositorySelection: 'all',
          suspendedAt: null,
          htmlUrl: 'https://github.com/apps/shipfox/installations/123',
          raw: {id: interaction.installationId},
        },
      }),
    ),
    connectGithubInstallation: vi.fn(() =>
      Promise.resolve(githubConnection({workspaceId: interaction.workspaceId})),
    ),
  };
}

describe('connectGithubInteraction', () => {
  it('connects a verified direct-install interaction', async () => {
    const interaction = installInteraction();
    const params = connectionParams(interaction);

    const result = await connectGithubInteraction(params);

    expect(result.workspaceId).toBe(interaction.workspaceId);
    expect(params.acquireInstallationProof).toHaveBeenCalledWith(interaction);
    expect(params.requireWorkspaceMembership).toHaveBeenCalledWith({
      workspaceId: interaction.workspaceId,
      userId: interaction.actorUserId,
      memberships: [],
    });
    expect(params.connectGithubInstallation).toHaveBeenCalledWith({
      workspaceId: interaction.workspaceId,
      installationId: '123',
      displayName: 'GitHub shipfox',
      installerUserId: interaction.actorUserId,
      actorUserId: interaction.actorUserId,
      installation: {
        installationId: '123',
        accountLogin: 'shipfox',
        accountType: 'Organization',
        repositorySelection: 'all',
        suspendedAt: null,
        deletedAt: null,
        latestEvent: {id: 123},
        installerUserId: interaction.actorUserId,
      },
    });
  });

  it('rejects a different session actor before acquiring provider proof', async () => {
    const params = connectionParams();
    params.sessionUserId = crypto.randomUUID();

    const result = connectGithubInteraction(params);

    await expect(result).rejects.toBeInstanceOf(GithubInstallStateActorMismatchError);
    expect(params.requireWorkspaceMembership).not.toHaveBeenCalled();
    expect(params.acquireInstallationProof).not.toHaveBeenCalled();
  });

  it('applies the current workspace membership check before acquiring provider proof', async () => {
    const params = connectionParams();
    const membershipError = new Error('membership removed');
    params.requireWorkspaceMembership.mockRejectedValue(membershipError);

    const result = connectGithubInteraction(params);

    await expect(result).rejects.toBe(membershipError);
    expect(params.acquireInstallationProof).not.toHaveBeenCalled();
  });

  it('returns an active same-workspace connection without reacquiring provider proof', async () => {
    const interaction = installInteraction();
    const params = connectionParams(interaction);
    const existing = githubConnection({workspaceId: interaction.workspaceId});
    params.getExistingGithubConnection.mockResolvedValue(existing);

    const result = await connectGithubInteraction(params);

    expect(result).toBe(existing);
    expect(params.acquireInstallationProof).not.toHaveBeenCalled();
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('rejects an installation owned by another workspace before acquiring provider proof', async () => {
    const params = connectionParams();
    params.getExistingGithubConnection.mockResolvedValue(githubConnection());

    const result = connectGithubInteraction(params);

    await expect(result).rejects.toBeInstanceOf(GithubInstallationAlreadyLinkedError);
    expect(params.acquireInstallationProof).not.toHaveBeenCalled();
  });

  it('rejects proof for a different installation', async () => {
    const params = connectionParams();
    params.acquireInstallationProof.mockResolvedValue({
      installation: {
        id: 999,
        account: {login: 'shipfox', type: 'Organization'},
        repositorySelection: 'all',
        suspendedAt: null,
        htmlUrl: 'https://github.com/apps/shipfox/installations/999',
        raw: {id: 999},
      },
    });

    const result = connectGithubInteraction(params);

    await expect(result).rejects.toBeInstanceOf(GithubInstallationNotAuthorizedError);
    expect(params.connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('preserves the commit-time ownership race guard', async () => {
    const params = connectionParams();
    const raceError = new GithubInstallationAlreadyLinkedError(123);
    params.connectGithubInstallation.mockRejectedValue(raceError);

    const result = connectGithubInteraction(params);

    await expect(result).rejects.toBe(raceError);
    expect(params.connectGithubInstallation).toHaveBeenCalledOnce();
  });
});
