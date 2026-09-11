import type {ClickUpInstallationLock} from '#db/installations.js';
import {
  ClickUpInstallationAlreadyLinkedError,
  ClickUpInstallStateActorMismatchError,
  ClickUpOAuthCallbackError,
  ClickUpWorkspaceCountError,
} from './errors.js';
import {handleClickUpCallback, handleClickUpOAuthCallbackError} from './install.js';
import {signClickUpInstallState} from './state.js';

function createParams() {
  const workspaceId = crypto.randomUUID();
  const state = signClickUpInstallState({workspaceId, userId: 'user-1'});
  const clickup = {
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({accessToken: 'access-token'}),
    getAuthorizedWorkspaces: vi.fn(),
    getAuthorizedUser: vi.fn().mockResolvedValue({id: 'clickup-user-1'}),
  };
  const tokenStore = {storeTokens: vi.fn().mockResolvedValue(undefined)};
  const connectClickUpInstallation = vi.fn().mockResolvedValue({
    id: 'connection-1',
    workspaceId,
    provider: 'clickup',
  });
  const disconnectClickUpInstallation = vi.fn().mockResolvedValue(undefined);
  const withClickUpInstallationLock: ClickUpInstallationLock = async (_teamId, fn) => fn();
  return {
    workspaceId,
    state,
    clickup,
    tokenStore,
    connectClickUpInstallation,
    disconnectClickUpInstallation,
    withClickUpInstallationLock,
    code: 'code',
    sessionUserId: 'user-1',
    sessionMemberships: [],
    requireWorkspaceMembership: vi.fn().mockResolvedValue(undefined),
    getExistingClickUpConnection: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ClickUp OAuth installation', () => {
  it('connects exactly one workspace, reads the user, and stores the token', async () => {
    const params = createParams();
    params.clickup.getAuthorizedWorkspaces.mockResolvedValue([{id: 'team-1', name: 'Acme'}]);

    const result = await handleClickUpCallback(params);

    expect(result).toMatchObject({id: 'connection-1'});
    expect(params.clickup.getAuthorizedUser).toHaveBeenCalledWith({accessToken: 'access-token'});
    expect(params.connectClickUpInstallation).toHaveBeenCalledWith({
      workspaceId: params.workspaceId,
      teamId: 'team-1',
      teamName: 'Acme',
      authorizingUserId: 'clickup-user-1',
      displayName: 'ClickUp Acme',
    });
    expect(params.tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: 'connection-1',
      accessToken: 'access-token',
      editedBy: 'user-1',
    });
  });

  it.each([
    {workspaces: []},
    {
      workspaces: [
        {id: 'team-1', name: 'Acme'},
        {id: 'team-2', name: 'Beta'},
      ],
    },
  ])('rejects a workspace grant with $workspaces.length workspaces without storing the token', async ({
    workspaces,
  }) => {
    const params = createParams();
    params.clickup.getAuthorizedWorkspaces.mockResolvedValue(workspaces);

    await expect(handleClickUpCallback(params)).rejects.toBeInstanceOf(ClickUpWorkspaceCountError);
    expect(params.clickup.getAuthorizedUser).not.toHaveBeenCalled();
    expect(params.tokenStore.storeTokens).not.toHaveBeenCalled();
    expect(params.connectClickUpInstallation).not.toHaveBeenCalled();
  });

  it('rejects a workspace already linked to another Shipfox workspace', async () => {
    const params = createParams();
    params.clickup.getAuthorizedWorkspaces.mockResolvedValue([{id: 'team-1', name: 'Acme'}]);
    params.getExistingClickUpConnection.mockResolvedValue({
      id: 'other-connection',
      workspaceId: 'other-workspace',
      provider: 'clickup',
    });

    await expect(handleClickUpCallback(params)).rejects.toBeInstanceOf(
      ClickUpInstallationAlreadyLinkedError,
    );
    expect(params.tokenStore.storeTokens).not.toHaveBeenCalled();
  });

  it('rejects a callback state created by another user before exchanging the code', async () => {
    const params = createParams();
    params.state = signClickUpInstallState({workspaceId: params.workspaceId, userId: 'other-user'});

    await expect(handleClickUpCallback(params)).rejects.toBeInstanceOf(
      ClickUpInstallStateActorMismatchError,
    );
    expect(params.clickup.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('validates membership and surfaces an OAuth error callback without exchanging a code', async () => {
    const params = createParams();
    const membershipError = new Error('membership rejected');
    params.requireWorkspaceMembership.mockRejectedValue(membershipError);

    await expect(
      handleClickUpOAuthCallbackError({
        state: params.state,
        error: 'access_denied',
        errorDescription: 'The user declined access',
        sessionUserId: params.sessionUserId,
        sessionMemberships: params.sessionMemberships,
        requireWorkspaceMembership: params.requireWorkspaceMembership,
      }),
    ).rejects.toBe(membershipError);

    params.requireWorkspaceMembership.mockResolvedValue(undefined);
    await expect(
      handleClickUpOAuthCallbackError({
        state: params.state,
        error: 'access_denied',
        errorDescription: 'The user declined access',
        sessionUserId: params.sessionUserId,
        sessionMemberships: params.sessionMemberships,
        requireWorkspaceMembership: params.requireWorkspaceMembership,
      }),
    ).rejects.toMatchObject({
      constructor: ClickUpOAuthCallbackError,
      providerError: 'access_denied',
      providerDescription: 'The user declined access',
    });
  });

  it('cleans up a new connection when token storage fails', async () => {
    const params = createParams();
    params.clickup.getAuthorizedWorkspaces.mockResolvedValue([{id: 'team-1', name: 'Acme'}]);
    const storageError = new Error('secret storage unavailable');
    params.tokenStore.storeTokens.mockRejectedValue(storageError);

    await expect(handleClickUpCallback(params)).rejects.toBe(storageError);
    expect(params.disconnectClickUpInstallation).toHaveBeenCalledWith({
      connectionId: 'connection-1',
    });
  });
});
