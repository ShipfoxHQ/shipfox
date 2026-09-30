import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createJiraE2eRoutes} from './index.js';

function connection(
  overrides: Partial<IntegrationConnection<'jira'>> = {},
): IntegrationConnection<'jira'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'jira',
    externalAccountId: 'jira-cloud',
    slug: 'jira_acme',
    displayName: 'Jira Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

describe('Jira E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a connection and stores its tokens without returning them', async () => {
    const tokenStore = {storeTokens: vi.fn(() => Promise.resolve())};
    const app = await createApp({
      routes: [
        createJiraE2eRoutes({
          tokenStore,
          getExistingJiraConnection: vi.fn(() => Promise.resolve(undefined)),
          connectJiraInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectJiraInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: ['agent_tools'],
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/jira-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        cloud_id: 'jira-cloud',
        site_url: 'https://acme.atlassian.net',
        site_name: 'Acme',
        authorizing_account_id: 'jira-user',
        display_name: 'Jira Acme',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: connection().id,
      provider: 'jira',
      capabilities: ['agent_tools'],
    });
    expect(response.body).not.toContain('access-token');
    expect(response.body).not.toContain('refresh-token');
    expect(tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: connection().id,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('records the webhook IDs the connection accepts deliveries for', async () => {
    const updateInstallationWebhook = vi.fn(() => Promise.resolve(undefined));
    const app = await createApp({
      routes: [
        createJiraE2eRoutes({
          tokenStore: {storeTokens: vi.fn(() => Promise.resolve())},
          getExistingJiraConnection: vi.fn(() => Promise.resolve(undefined)),
          connectJiraInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectJiraInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: ['agent_tools'],
          updateInstallationWebhook,
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/jira-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        cloud_id: 'jira-cloud',
        site_url: 'https://acme.atlassian.net',
        site_name: 'Acme',
        authorizing_account_id: 'jira-user',
        display_name: 'Jira Acme',
        access_token: 'access-token',
        webhook_ids: [4242],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(updateInstallationWebhook).toHaveBeenCalledWith({
      connectionId: connection().id,
      webhookIds: [4242],
      webhookExpiresAt: null,
    });
  });

  it('leaves the installation webhooks alone without webhook IDs', async () => {
    const updateInstallationWebhook = vi.fn(() => Promise.resolve(undefined));
    const app = await createApp({
      routes: [
        createJiraE2eRoutes({
          tokenStore: {storeTokens: vi.fn(() => Promise.resolve())},
          getExistingJiraConnection: vi.fn(() => Promise.resolve(undefined)),
          connectJiraInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectJiraInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: ['agent_tools'],
          updateInstallationWebhook,
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/jira-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        cloud_id: 'jira-cloud',
        site_url: 'https://acme.atlassian.net',
        site_name: 'Acme',
        authorizing_account_id: 'jira-user',
        display_name: 'Jira Acme',
        access_token: 'access-token',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(updateInstallationWebhook).not.toHaveBeenCalled();
  });

  it('rejects malformed connection bodies', async () => {
    const app = await createApp({
      routes: [
        createJiraE2eRoutes({
          tokenStore: {storeTokens: vi.fn(() => Promise.resolve())},
          getExistingJiraConnection: vi.fn(() => Promise.resolve(undefined)),
          connectJiraInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectJiraInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: ['agent_tools'],
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/jira-connections',
      payload: {workspace_id: 'not-a-uuid'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'validation-error'});
  });
});
