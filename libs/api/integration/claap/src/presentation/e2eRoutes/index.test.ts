import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createClaapE2eRoutes} from './index.js';

function connection(
  overrides: Partial<IntegrationConnection<'claap'>> = {},
): IntegrationConnection<'claap'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'claap',
    externalAccountId: 'q2IqD9wUHb',
    slug: 'claap_mercateam',
    displayName: 'Claap Mercateam',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Claap E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a seeded connection and maps it to the response', async () => {
    const seededConnection = connection({lifecycleStatus: 'error'});
    const seedClaapConnection = vi.fn(() => Promise.resolve(seededConnection));
    const app = await createApp({
      routes: [createClaapE2eRoutes({seedClaapConnection})],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/claap-connections',
      payload: {
        workspace_id: seededConnection.workspaceId,
        api_key: 'cla_e2e_key',
        claap_workspace_id: 'q2IqD9wUHb',
        claap_workspace_name: 'Mercateam',
        lifecycle_status: 'error',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: seededConnection.id,
      workspace_id: seededConnection.workspaceId,
      provider: seededConnection.provider,
      external_account_id: seededConnection.externalAccountId,
      slug: seededConnection.slug,
      display_name: seededConnection.displayName,
      lifecycle_status: seededConnection.lifecycleStatus,
      capabilities: [],
      created_at: seededConnection.createdAt.toISOString(),
      updated_at: seededConnection.updatedAt.toISOString(),
    });
    expect(seedClaapConnection).toHaveBeenCalledWith({
      workspaceId: seededConnection.workspaceId,
      apiKey: 'cla_e2e_key',
      claapWorkspaceId: 'q2IqD9wUHb',
      claapWorkspaceName: 'Mercateam',
      lifecycleStatus: 'error',
    });
  });
});
