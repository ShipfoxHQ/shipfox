describe('gitea instance driver', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('crypto', {randomUUID: () => '12345678-1234-4234-8234-123456789abc'});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('creates org infrastructure with a read-only bot membership and push webhook', async () => {
    const giteaFetch = vi.fn().mockResolvedValue(undefined);
    const giteaFetchJson = vi.fn().mockResolvedValueOnce({id: 17}).mockResolvedValueOnce({id: 23});
    vi.doMock('./config.js', () => ({
      config: {
        E2E_GITEA_BOT_USERNAME: 'shipfox-bot',
        E2E_GITEA_WEBHOOK_SECRET: 'webhook-secret',
      },
      defaultWebhookTargetUrl: () => 'https://api.example.test/integrations/gitea/webhook',
    }));
    vi.doMock('./gitea-client.js', () => ({
      encodeSegment: encodeURIComponent,
      GiteaInstanceError: class GiteaInstanceError extends Error {},
      giteaFetch,
      giteaFetchJson,
    }));
    const {createOrg} = await import('./instance.js');

    const result = await createOrg({name: 'e2e-org'});

    expect(giteaFetch).toHaveBeenCalledWith('orgs', {
      method: 'POST',
      json: {username: 'e2e-org', visibility: 'public'},
    });
    expect(giteaFetchJson).toHaveBeenCalledWith('orgs/e2e-org/teams', {
      method: 'POST',
      json: {
        name: 'shipfox-readers',
        permission: 'read',
        includes_all_repositories: true,
        units: ['repo.code'],
      },
    });
    expect(giteaFetch).toHaveBeenCalledWith('teams/17/members/shipfox-bot', {method: 'PUT'});
    expect(giteaFetchJson).toHaveBeenCalledWith('orgs/e2e-org/hooks', {
      method: 'POST',
      json: {
        type: 'gitea',
        active: true,
        events: ['push'],
        config: {
          url: 'https://api.example.test/integrations/gitea/webhook',
          content_type: 'json',
          secret: 'webhook-secret',
        },
      },
    });
    expect(result).toEqual({org: 'e2e-org', teamId: 17, webhookId: 23});
  });

  test('rolls back the org when setup fails after creation', async () => {
    const error = new Error('team creation failed');
    const giteaFetch = vi.fn().mockResolvedValue(undefined);
    const giteaFetchJson = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce([]);
    vi.doMock('./config.js', () => ({
      config: {
        E2E_GITEA_BOT_USERNAME: 'shipfox-bot',
        E2E_GITEA_WEBHOOK_SECRET: 'webhook-secret',
      },
      defaultWebhookTargetUrl: () => 'https://api.example.test/integrations/gitea/webhook',
    }));
    vi.doMock('./gitea-client.js', () => ({
      encodeSegment: encodeURIComponent,
      GiteaInstanceError: class GiteaInstanceError extends Error {},
      giteaFetch,
      giteaFetchJson,
    }));
    const {createOrg} = await import('./instance.js');

    const result = createOrg({name: 'e2e-org'});

    await expect(result).rejects.toBe(error);
    expect(giteaFetch).toHaveBeenCalledWith('orgs/e2e-org', {method: 'DELETE'});
  });
});
