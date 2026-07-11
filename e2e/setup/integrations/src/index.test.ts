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
});
