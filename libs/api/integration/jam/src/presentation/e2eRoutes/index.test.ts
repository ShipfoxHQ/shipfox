import {closeApp, createApp} from '@shipfox/node-fastify';
import {jamConnection} from '#test/fixtures/jam.js';
import {createJamE2eRoutes} from './index.js';

describe('Jam E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a seeded connection and maps it to the response', async () => {
    const seededConnection = jamConnection({lifecycleStatus: 'error'});
    const seedJamConnection = vi.fn(() => Promise.resolve(seededConnection));
    const app = await createApp({
      routes: [createJamE2eRoutes({seedJamConnection})],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/jam-connections',
      payload: {
        workspace_id: seededConnection.workspaceId,
        token: 'jam_pat_e2e',
        team_id: seededConnection.externalAccountId,
        user_id: 'user-1',
        user_name: 'Ada',
        user_email: 'ada@example.com',
        lifecycle_status: 'error',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: seededConnection.id,
      workspace_id: seededConnection.workspaceId,
      provider: 'jam',
      external_account_id: seededConnection.externalAccountId,
      slug: 'jam',
      display_name: 'Jam',
      lifecycle_status: 'error',
      capabilities: [],
      created_at: seededConnection.createdAt.toISOString(),
      updated_at: seededConnection.updatedAt.toISOString(),
    });
    expect(seedJamConnection).toHaveBeenCalledWith({
      workspaceId: seededConnection.workspaceId,
      token: 'jam_pat_e2e',
      teamId: seededConnection.externalAccountId,
      userId: 'user-1',
      userName: 'Ada',
      userEmail: 'ada@example.com',
      lifecycleStatus: 'error',
    });
  });
});
