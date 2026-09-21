vi.mock('#db/installations.js', () => ({
  withNotionGrantLock: vi.fn(
    async (_connectionId: string, fn: () => Promise<unknown>) => await fn(),
  ),
}));

import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {NotionApiClient, NotionOAuthAuthorization} from '#api/client.js';
import {handleNotionCallback, handleNotionOAuthCallbackError} from './install.js';
import {signNotionInstallState} from './state.js';

function connection(workspaceId: string): IntegrationConnection<'notion'> {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    provider: 'notion',
    externalAccountId: 'notion-workspace',
    slug: 'notion_acme',
    displayName: 'Notion Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    repositoryAccessMode: 'selected',
  };
}

function authorization(): NotionOAuthAuthorization {
  return {
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
    botId: 'new-bot-id',
    workspaceId: 'notion-workspace',
    workspaceName: 'Acme',
  };
}

function callbackParams(overrides: Record<string, unknown> = {}) {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const state = signNotionInstallState({workspaceId, userId: 'shipfox-user'});
  const auth = authorization();
  const notion: NotionApiClient = {
    exchangeAuthorizationCode: vi.fn(async () => auth),
    refreshAccessToken: vi.fn(),
    revokeToken: vi.fn(async () => undefined),
  };
  const tokenStore = {
    storeTokens: vi.fn(async () => undefined),
    getTokens: vi.fn(async () => ({
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
    })),
  };
  const params = {
    notion,
    tokenStore,
    code: 'code',
    state,
    sessionUserId: 'shipfox-user',
    sessionMemberships: [],
    requireWorkspaceMembership: vi.fn(async () => undefined),
    getExistingNotionConnection: vi.fn(async () => undefined),
    getNotionInstallationByConnectionId: vi.fn(async () => undefined),
    connectNotionInstallation: vi.fn(async (input) => connection(input.workspaceId)),
    restoreNotionInstallation: vi.fn(async () => undefined),
    disconnectNotionInstallation: vi.fn(async () => undefined),
    ...overrides,
  };
  return {params, state, workspaceId, notion, tokenStore, auth};
}

describe('Notion OAuth installation', () => {
  it('connects a workspace, records actor provenance, and stores the exchanged grant', async () => {
    const {params, workspaceId, tokenStore} = callbackParams();

    const result = await handleNotionCallback(params);

    expect(result.reconnected).toBe(false);
    expect(result.connection.workspaceId).toBe(workspaceId);
    expect(params.connectNotionInstallation).toHaveBeenCalledWith({
      workspaceId,
      notionWorkspaceId: 'notion-workspace',
      workspaceName: 'Acme',
      botId: 'new-bot-id',
      authorizedByUserId: 'shipfox-user',
      tokenExpiresAt: null,
      lifecycleStatus: 'active',
      displayName: 'Notion Acme',
      actorUserId: 'shipfox-user',
    });
    expect(tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: result.connection.id,
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      editedBy: 'shipfox-user',
    });
  });

  it('revokes the new grant and disconnects a first install when token storage fails', async () => {
    const {params, notion} = callbackParams({
      tokenStore: {
        storeTokens: vi.fn(() => Promise.reject(new Error('secret store down'))),
        getTokens: vi.fn(async () => ({accessToken: 'old-access-token'})),
      },
    });

    await expect(handleNotionCallback(params)).rejects.toThrow('secret store down');
    expect(notion.revokeToken).toHaveBeenCalledWith({token: 'new-access-token'});
    expect(notion.revokeToken).toHaveBeenCalledWith({token: 'new-refresh-token'});
    expect(params.disconnectNotionInstallation).toHaveBeenCalledWith({
      connectionId: expect.any(String),
    });
    expect(params.tokenStore.storeTokens).toHaveBeenCalledTimes(1);
  });

  it('revokes a newly exchanged grant when the Notion workspace is linked elsewhere', async () => {
    const {params, notion} = callbackParams({
      getExistingNotionConnection: vi.fn(async () =>
        connection('00000000-0000-4000-8000-000000000099'),
      ),
    });

    await expect(handleNotionCallback(params)).rejects.toMatchObject({
      name: 'NotionInstallationAlreadyLinkedError',
    });
    expect(notion.revokeToken).toHaveBeenCalledWith({token: 'new-access-token'});
    expect(params.connectNotionInstallation).not.toHaveBeenCalled();
  });

  it('restores the previous pair and installation when reconnect storage fails', async () => {
    const existing = connection('00000000-0000-4000-8000-000000000001');
    const previousInstallation = {
      id: crypto.randomUUID(),
      connectionId: existing.id,
      notionWorkspaceId: 'notion-workspace',
      workspaceName: 'Old Acme',
      botId: 'old-bot-id',
      authorizedByUserId: 'old-shipfox-user',
      tokenExpiresAt: null,
      status: 'installed' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const storeTokens = vi
      .fn()
      .mockRejectedValueOnce(new Error('secret store down'))
      .mockResolvedValue(undefined);
    const {params, notion} = callbackParams({
      getExistingNotionConnection: vi.fn(async () => existing),
      getNotionInstallationByConnectionId: vi.fn(async () => previousInstallation),
      connectNotionInstallation: vi.fn(async () => existing),
      tokenStore: {
        storeTokens,
        getTokens: vi.fn(async () => ({
          accessToken: 'old-access-token',
          refreshToken: 'old-refresh-token',
        })),
      },
    });

    await expect(handleNotionCallback(params)).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
    expect(storeTokens).toHaveBeenLastCalledWith({
      connectionId: existing.id,
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      lockAlreadyHeld: true,
    });
    expect(params.restoreNotionInstallation).toHaveBeenCalledWith(previousInstallation);
    expect(notion.revokeToken).toHaveBeenCalledWith({token: 'new-access-token'});
  });

  it('treats denied consent as a neutral, validated callback outcome', async () => {
    const {state} = callbackParams();

    await expect(
      handleNotionOAuthCallbackError({
        state,
        error: 'access_denied',
        sessionUserId: 'shipfox-user',
        sessionMemberships: [],
        requireWorkspaceMembership: vi.fn(async () => undefined),
      }),
    ).resolves.toEqual({outcome: 'access_denied'});
  });
});
