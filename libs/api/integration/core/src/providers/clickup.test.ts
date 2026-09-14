import * as clickupPackage from '@shipfox/api-integration-clickup';
import {runMigrations} from '@shipfox/node-drizzle';
import {createApp} from '@shipfox/node-fastify';
import {
  getIntegrationConnectionById,
  listIntegrationConnections,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {createTestApp, useIntegrationRouteTest} from '#test/route-utils.js';
import {clickupNamespaceSuffix, clickupProviderModule} from './clickup.js';

const mocks = vi.hoisted(() => ({
  deleteWebhook: vi.fn(),
}));

async function loadClickUpProvider(options: {
  getSecret?: (input: {key: string}) => Promise<string | null>;
  setSecrets?: () => Promise<void>;
}) {
  vi.spyOn(clickupPackage, 'createClickUpApiClient').mockReturnValue({
    exchangeAuthorizationCode: vi.fn(),
    getAuthorizedWorkspaces: vi.fn(),
    getAuthorizedUser: vi.fn(),
    createWebhook: vi.fn(),
    deleteWebhook: mocks.deleteWebhook,
  });
  const deleteSecrets = vi.fn(() => Promise.resolve(1));
  const clickupPart = await clickupProviderModule.load({
    secrets: {
      clickup: {
        getSecret: options.getSecret ?? (() => Promise.resolve('access-token')),
        setSecrets: options.setSecrets ?? (() => Promise.resolve()),
        deleteSecrets,
      },
      deleteSecrets: vi.fn(() => Promise.resolve(1)),
    },
  });
  if (!clickupPart.database) throw new Error('ClickUp provider database is not configured');
  await runMigrations(
    clickupPart.database.db(),
    clickupPart.database.migrationsPath,
    `__drizzle_migrations_${clickupPart.database.databaseNamespace}`,
  );
  return {clickupPart, deleteSecrets};
}

beforeEach(() => {
  mocks.deleteWebhook.mockReset();
});

describe('ClickUp secret namespace', () => {
  it('accepts only the ClickUp namespace prefix', () => {
    expect(clickupNamespaceSuffix('system/integrations/clickup/connection-id')).toBe(
      'connection-id',
    );
    expect(() => clickupNamespaceSuffix('system/integrations/jira/connection-id')).toThrow(
      'unscoped secret namespace',
    );
  });
});

describe('clickupProviderModule lifecycle cleanup', () => {
  const context = useIntegrationRouteTest();

  it('removes local state when connection webhook deletion fails', async () => {
    const {clickupPart, deleteSecrets} = await loadClickUpProvider({});
    mocks.deleteWebhook.mockRejectedValue(new Error('provider unavailable'));
    const teamId = `team-${crypto.randomUUID()}`;
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'clickup',
      externalAccountId: teamId,
      slug: `clickup_${teamId}`,
      displayName: 'ClickUp Acme',
      capabilities: ['agent_tools'],
    });
    await clickupPackage.upsertClickUpInstallation({
      connectionId: connection.id,
      teamId,
      teamName: 'Acme',
      authorizingUserId: 'user-1',
      webhookId: 'webhook-1',
      status: 'installed',
    });
    const app = await createTestApp([clickupPart.provider]);

    const response = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(204);
    expect(mocks.deleteWebhook).toHaveBeenCalledWith({
      accessToken: 'access-token',
      webhookId: 'webhook-1',
    });
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
    await expect(
      clickupPackage.getClickUpInstallationByConnectionId(connection.id),
    ).resolves.toBeUndefined();
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      namespace: connection.id,
    });
  });

  it('removes a partially created connection when token storage fails', async () => {
    const storageError = new Error('secret storage unavailable');
    const {clickupPart, deleteSecrets} = await loadClickUpProvider({
      getSecret: () => Promise.resolve(null),
      setSecrets: () => Promise.reject(storageError),
    });
    if (!clickupPart.e2eRoutes) throw new Error('ClickUp E2E routes are not configured');
    const app = await createApp({routes: clickupPart.e2eRoutes, swagger: false});
    const teamId = `team-${crypto.randomUUID()}`;

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/clickup-connections',
      payload: {
        workspace_id: context.workspaceId,
        team_id: teamId,
        team_name: 'Acme',
        authorizing_user_id: 'user-1',
        access_token: 'access-token',
        webhook_id: 'webhook-1',
        webhook_secret: 'webhook-secret',
        display_name: 'ClickUp Acme',
      },
    });

    expect(response.statusCode).toBe(500);
    await expect(clickupPackage.getClickUpInstallationByTeamId(teamId)).resolves.toBeUndefined();
    await expect(listIntegrationConnections({workspaceId: context.workspaceId})).resolves.toEqual(
      [],
    );
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      namespace: expect.any(String),
    });
  });
});
