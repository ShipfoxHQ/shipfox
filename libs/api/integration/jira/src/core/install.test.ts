import {
  JiraOfflineAccessNotGrantedError,
  JiraPendingSelectionNotFoundError,
  JiraSiteSelectionMismatchError,
} from './errors.js';
import {handleJiraCallback, handleJiraSiteSelection} from './install.js';
import {signJiraInstallState} from './state.js';

function createParams() {
  const workspaceId = crypto.randomUUID();
  const state = signJiraInstallState({workspaceId, userId: 'user-1'});
  const jira = {
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: new Date(),
      scopes: [],
    }),
    getAccessibleResources: vi.fn(),
    getMyself: vi.fn().mockResolvedValue({accountId: 'account-1'}),
    refreshAccessToken: vi.fn(),
  };
  const tokenStore = {storeTokens: vi.fn().mockResolvedValue(undefined)};
  const pendingStore = {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn(),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const connectJiraInstallation = vi
    .fn()
    .mockResolvedValue({id: 'connection-1', workspaceId, provider: 'jira'});
  return {
    workspaceId,
    state,
    jira,
    tokenStore,
    pendingStore,
    connectJiraInstallation,
    code: 'code',
    sessionUserId: 'user-1',
    sessionMemberships: [],
    requireWorkspaceMembership: vi.fn().mockResolvedValue(undefined),
    getExistingJiraConnection: vi.fn().mockResolvedValue(undefined),
    disconnectJiraInstallation: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Jira OAuth installation', () => {
  it('connects a single granted site and stores its tokens', async () => {
    const params = createParams();
    params.jira.getAccessibleResources.mockResolvedValue([
      {
        cloudId: 'cloud-1',
        name: 'Acme',
        url: 'https://acme.atlassian.net',
        scopes: ['read:jira-work'],
      },
    ]);

    const result = await handleJiraCallback(params);

    expect(result).toMatchObject({id: 'connection-1'});
    expect(params.connectJiraInstallation).toHaveBeenCalledWith(
      expect.objectContaining({cloudId: 'cloud-1'}),
    );
    expect(params.tokenStore.storeTokens).toHaveBeenCalledWith(
      expect.objectContaining({connectionId: 'connection-1', refreshToken: 'refresh'}),
    );
  });

  it('stores a multi-site grant until the selected site completes', async () => {
    const params = createParams();
    const sites = [
      {
        cloudId: 'cloud-1',
        name: 'Acme',
        url: 'https://acme.atlassian.net',
        scopes: ['read:jira-work'],
      },
      {
        cloudId: 'cloud-2',
        name: 'Beta',
        url: 'https://beta.atlassian.net',
        scopes: ['read:issue:jira'],
      },
    ];
    params.jira.getAccessibleResources.mockResolvedValue(sites);

    const callback = await handleJiraCallback(params);
    params.pendingStore.load.mockResolvedValue({
      authorization: {accessToken: 'access', refreshToken: 'refresh', scopes: []},
      sites,
    });
    const completed = await handleJiraSiteSelection({...params, cloudId: 'cloud-2'});

    expect(callback).toEqual({sites});
    expect(params.pendingStore.save).toHaveBeenCalled();
    expect(completed).toMatchObject({id: 'connection-1'});
    expect(params.pendingStore.clear).toHaveBeenCalledWith({
      workspaceId: params.workspaceId,
      state: params.state,
    });
  });

  it('rejects missing refresh tokens and invalid pending selections', async () => {
    const missingRefresh = createParams();
    missingRefresh.jira.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access',
      scopes: [],
    });
    const missingPending = createParams();
    missingPending.pendingStore.load.mockResolvedValue(undefined);
    const mismatchedSite = createParams();
    mismatchedSite.pendingStore.load.mockResolvedValue({
      authorization: {accessToken: 'access', refreshToken: 'refresh', scopes: []},
      sites: [],
    });

    await expect(handleJiraCallback(missingRefresh)).rejects.toBeInstanceOf(
      JiraOfflineAccessNotGrantedError,
    );
    await expect(
      handleJiraSiteSelection({...missingPending, cloudId: 'cloud-1'}),
    ).rejects.toBeInstanceOf(JiraPendingSelectionNotFoundError);
    await expect(
      handleJiraSiteSelection({...mismatchedSite, cloudId: 'cloud-1'}),
    ).rejects.toBeInstanceOf(JiraSiteSelectionMismatchError);
  });
});
