import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createPosthogE2eRoutes} from './index.js';

function connection(
  overrides: Partial<IntegrationConnection<'posthog'>> = {},
): IntegrationConnection<'posthog'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'posthog',
    externalAccountId: 'posthog-project',
    slug: 'posthog_analytics',
    displayName: 'Analytics',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PostHog E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a seeded connection and maps it to the response', async () => {
    const seededConnection = connection();
    const seedPosthogConnection = vi.fn(() => Promise.resolve(seededConnection));
    const app = await createApp({
      routes: [createPosthogE2eRoutes({seedPosthogConnection})],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/posthog-connections',
      payload: {
        workspace_id: seededConnection.workspaceId,
        api_key: 'phx-e2e-key',
        project_id: seededConnection.externalAccountId,
        project_name: seededConnection.displayName,
        organization_id: 'posthog-organization',
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
    expect(seedPosthogConnection).toHaveBeenCalledWith({
      workspaceId: seededConnection.workspaceId,
      apiKey: 'phx-e2e-key',
      projectId: seededConnection.externalAccountId,
      projectName: seededConnection.displayName,
      organizationId: 'posthog-organization',
    });
  });
});
