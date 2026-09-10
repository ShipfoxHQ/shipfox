import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createClickUpE2eRoutes} from './index.js';

function connection(
  overrides: Partial<IntegrationConnection<'clickup'>> = {},
): IntegrationConnection<'clickup'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'clickup',
    externalAccountId: 'clickup-team',
    slug: 'clickup_acme',
    displayName: 'ClickUp Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

describe('ClickUp E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a connection and stores both secrets without returning either', async () => {
    const tokenStore = {storeTokens: vi.fn(() => Promise.resolve())};
    const app = await createApp({
      routes: [
        createClickUpE2eRoutes({
          tokenStore,
          getExistingClickUpConnection: vi.fn(() => Promise.resolve(undefined)),
          connectClickUpInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectClickUpInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: [],
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/clickup-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        team_id: 'clickup-team',
        team_name: 'Acme',
        authorizing_user_id: 'clickup-user',
        access_token: 'access-token',
        webhook_id: 'webhook-id',
        webhook_secret: 'webhook-secret',
        display_name: 'ClickUp Acme',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({id: connection().id, provider: 'clickup'});
    expect(response.body).not.toContain('access-token');
    expect(response.body).not.toContain('webhook-secret');
    expect(tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: connection().id,
      accessToken: 'access-token',
      webhookSecret: 'webhook-secret',
    });
  });
});
