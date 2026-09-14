import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {ClickUpInstallationLock} from '#db/installations.js';
import {
  ClickUpInstallationAlreadyLinkedError,
  ClickUpInstallStateActorMismatchError,
  ClickUpInstallStateError,
  ClickUpOAuthCallbackError,
  ClickUpWorkspaceCountError,
} from './errors.js';
import {handleClickUpCallback, handleClickUpOAuthCallbackError} from './install.js';
import {signClickUpInstallState} from './state.js';

function createParams() {
  const workspaceId = crypto.randomUUID();
  const stateNonce = crypto.randomUUID();
  const state = signClickUpInstallState({workspaceId, userId: 'user-1', nonce: stateNonce});
  const clickup = {
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({accessToken: 'access-token'}),
    getAuthorizedWorkspaces: vi.fn(),
    getAuthorizedUser: vi.fn().mockResolvedValue({id: 'clickup-user-1'}),
    createWebhook: vi.fn().mockResolvedValue({id: 'webhook-1', secret: 'webhook-secret'}),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const tokenStore = {storeTokens: vi.fn().mockResolvedValue(undefined)};
  const updateClickUpInstallationWebhook = vi.fn().mockResolvedValue({id: 'installation-1'});
  const connection = {
    id: 'connection-1',
    workspaceId,
    provider: 'clickup',
    externalAccountId: 'team-1',
    slug: 'clickup_acme',
    displayName: 'ClickUp Acme',
    lifecycleStatus: 'error',
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies IntegrationConnection<'clickup'>;
  const activeConnection = {
    ...connection,
    lifecycleStatus: 'active',
  } satisfies IntegrationConnection<'clickup'>;
  const markConnectionActive = vi.fn().mockResolvedValue(activeConnection);
  const markConnectionError = vi.fn().mockResolvedValue(undefined);
  const connectClickUpInstallation = vi.fn().mockResolvedValue(connection);
  const disconnectClickUpInstallation = vi.fn().mockResolvedValue(undefined);
  const withClickUpInstallationLock: ClickUpInstallationLock = async (_teamId, fn) => fn();
  return {
    workspaceId,
    state,
    stateNonce,
    clickup,
    tokenStore,
    connectClickUpInstallation,
    disconnectClickUpInstallation,
    updateClickUpInstallationWebhook,
    markConnectionActive,
    markConnectionError,
    activeConnection,
    webhookUrlForConnection: (connectionId: string) =>
      `https://shipfox.example.test/webhooks/${connectionId}`,
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

    expect(result).toBe(params.activeConnection);
    expect(params.clickup.getAuthorizedUser).toHaveBeenCalledWith({accessToken: 'access-token'});
    expect(params.connectClickUpInstallation).toHaveBeenCalledWith({
      workspaceId: params.workspaceId,
      teamId: 'team-1',
      teamName: 'Acme',
      authorizingUserId: 'clickup-user-1',
      displayName: 'ClickUp Acme',
    });
    expect(params.tokenStore.storeTokens).toHaveBeenNthCalledWith(1, {
      connectionId: 'connection-1',
      accessToken: 'access-token',
      editedBy: 'user-1',
    });
    expect(params.clickup.createWebhook).toHaveBeenCalledWith({
      accessToken: 'access-token',
      teamId: 'team-1',
      endpoint: 'https://shipfox.example.test/webhooks/connection-1',
      events: expect.arrayContaining([
        'taskCreated',
        'taskUpdated',
        'taskDeleted',
        'taskMoved',
        'taskStatusUpdated',
        'taskAssigneeUpdated',
        'taskPriorityUpdated',
        'taskDueDateUpdated',
        'taskTagUpdated',
        'taskCommentPosted',
        'taskCommentUpdated',
      ]),
    });
    expect(params.tokenStore.storeTokens).toHaveBeenNthCalledWith(2, {
      connectionId: 'connection-1',
      accessToken: 'access-token',
      webhookSecret: 'webhook-secret',
      editedBy: 'user-1',
    });
    expect(params.updateClickUpInstallationWebhook).toHaveBeenCalledWith({
      connectionId: 'connection-1',
      webhookId: 'webhook-1',
    });
    expect(params.markConnectionActive).toHaveBeenCalledWith({connectionId: 'connection-1'});
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
    params.state = signClickUpInstallState({
      workspaceId: params.workspaceId,
      userId: 'other-user',
      nonce: params.stateNonce,
    });

    await expect(handleClickUpCallback(params)).rejects.toBeInstanceOf(
      ClickUpInstallStateActorMismatchError,
    );
    expect(params.clickup.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('rejects a callback state from another browser session before exchanging the code', async () => {
    const params = createParams();
    params.stateNonce = crypto.randomUUID();

    await expect(handleClickUpCallback(params)).rejects.toBeInstanceOf(ClickUpInstallStateError);
    expect(params.clickup.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('validates membership and surfaces an OAuth error callback without exchanging a code', async () => {
    const params = createParams();
    const membershipError = new Error('membership rejected');
    params.requireWorkspaceMembership.mockRejectedValue(membershipError);

    await expect(
      handleClickUpOAuthCallbackError({
        state: params.state,
        stateNonce: params.stateNonce,
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
        stateNonce: params.stateNonce,
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

  it('compensates a created webhook and marks the connection errored when registration fails', async () => {
    const params = createParams();
    params.clickup.getAuthorizedWorkspaces.mockResolvedValue([{id: 'team-1', name: 'Acme'}]);
    const registrationError = new Error('webhook metadata unavailable');
    params.updateClickUpInstallationWebhook.mockRejectedValueOnce(registrationError);

    await expect(handleClickUpCallback(params)).rejects.toBe(registrationError);
    expect(params.clickup.deleteWebhook).toHaveBeenCalledWith({
      accessToken: 'access-token',
      webhookId: 'webhook-1',
    });
    expect(params.markConnectionError).toHaveBeenCalledWith({connectionId: 'connection-1'});
  });

  it('keeps the webhook id available for disconnect when compensation deletion fails', async () => {
    const params = createParams();
    params.clickup.getAuthorizedWorkspaces.mockResolvedValue([{id: 'team-1', name: 'Acme'}]);
    params.updateClickUpInstallationWebhook.mockRejectedValueOnce(new Error('metadata failed'));
    params.clickup.deleteWebhook.mockRejectedValueOnce(new Error('remote deletion failed'));

    await expect(handleClickUpCallback(params)).rejects.toThrow('metadata failed');
    expect(params.markConnectionError).toHaveBeenCalledWith({connectionId: 'connection-1'});
    expect(params.updateClickUpInstallationWebhook).toHaveBeenLastCalledWith({
      connectionId: 'connection-1',
      webhookId: 'webhook-1',
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
      lockAlreadyHeld: true,
    });
  });
});
