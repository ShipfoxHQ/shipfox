import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';

const requestJson = vi.fn();

describe('integrations E2E setup helper', () => {
  beforeEach(() => {
    vi.resetModules();
    requestJson.mockReset();
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
  });

  it('creates Linear connections through the protected setup route', async () => {
    requestJson.mockResolvedValueOnce({id: 'connection-id'});
    const {createLinearConnection} = await import('./index.js');

    await createLinearConnection({
      workspaceId: 'workspace-id',
      organizationId: 'linear-org',
      organizationUrlKey: 'acme',
      appUserId: 'linear-app-user',
      displayName: 'Linear Acme',
      accessToken: 'linear-e2e-token',
      scopes: ['read', 'write'],
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/integrations/linear-connections', {
      json: {
        workspace_id: 'workspace-id',
        organization_id: 'linear-org',
        organization_url_key: 'acme',
        app_user_id: 'linear-app-user',
        display_name: 'Linear Acme',
        access_token: 'linear-e2e-token',
        scopes: ['read', 'write'],
      },
    });
  });

  it('creates GitHub connections through the protected setup route', async () => {
    requestJson.mockResolvedValueOnce({id: 'connection-id'});
    const {createGithubConnection} = await import('./index.js');

    await createGithubConnection({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      installationId: 1234,
      accountLogin: 'shipfox-e2e',
      displayName: 'GitHub Shipfox E2E',
      installerUserId: '00000000-0000-4000-8000-000000000002',
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/integrations/github-connections', {
      json: {
        workspace_id: '00000000-0000-4000-8000-000000000001',
        installation_id: 1234,
        account_login: 'shipfox-e2e',
        display_name: 'GitHub Shipfox E2E',
        installer_user_id: '00000000-0000-4000-8000-000000000002',
      },
    });
  });
});
