import * as notionPackage from '@shipfox/api-integration-notion';
import {runMigrations} from '@shipfox/node-drizzle';
import {createApp} from '@shipfox/node-fastify';
import {getIntegrationConnectionById, listIntegrationConnections} from '#db/connections.js';
import {createTestApp, useIntegrationRouteTest} from '#test/route-utils.js';
import {notionNamespaceSuffix, notionProviderModule} from './notion.js';

async function loadNotionProvider() {
  const deleteSecrets = vi.fn(() => Promise.resolve(1));
  const notionPart = await notionProviderModule.load({
    secrets: {
      notion: {
        getSecret: vi.fn(async () => 'access-token'),
        setSecrets: vi.fn(async () => undefined),
        deleteSecrets,
      },
      deleteSecrets: vi.fn(async () => 1),
    },
  });
  if (!notionPart.database) throw new Error('Notion provider database is not configured');
  await runMigrations(
    notionPart.database.db(),
    notionPart.database.migrationsPath,
    `__drizzle_migrations_${notionPart.database.databaseNamespace}`,
  );
  return {notionPart, deleteSecrets};
}

describe('Notion secret namespace', () => {
  it('accepts only the Notion namespace prefix', () => {
    expect(notionNamespaceSuffix('system/integrations/notion/connection-id')).toBe('connection-id');
    expect(() => notionNamespaceSuffix('system/integrations/jira/connection-id')).toThrow(
      'unscoped secret namespace',
    );
  });
});

describe('notionProviderModule lifecycle cleanup', () => {
  const context = useIntegrationRouteTest();

  it('deletes local state and secrets, then allows the same workspace to reinstall', async () => {
    const {notionPart, deleteSecrets} = await loadNotionProvider();
    if (!notionPart.e2eRoutes) throw new Error('Notion E2E routes are not configured');
    const app = await createApp({routes: notionPart.e2eRoutes, swagger: false});
    const notionWorkspaceId = crypto.randomUUID();
    const botId = crypto.randomUUID();
    const authorizedByUserId = crypto.randomUUID();

    const first = await app.inject({
      method: 'POST',
      url: '/integrations/notion-connections',
      payload: {
        workspace_id: context.workspaceId,
        notion_workspace_id: notionWorkspaceId,
        workspace_name: 'Acme',
        bot_id: botId,
        authorized_by_user_id: authorizedByUserId,
        access_token: 'access-token',
        display_name: 'Notion Acme',
      },
    });
    expect(first.statusCode).toBe(201);
    const connection = first.json();

    const reseeded = await app.inject({
      method: 'POST',
      url: '/integrations/notion-connections',
      payload: {
        workspace_id: context.workspaceId.toUpperCase(),
        notion_workspace_id: notionWorkspaceId,
        workspace_name: 'Acme',
        bot_id: botId,
        authorized_by_user_id: authorizedByUserId,
        access_token: 'replacement-token',
        display_name: 'Notion Acme',
      },
    });
    expect(reseeded.statusCode).toBe(201);
    expect(reseeded.json().id).toBe(connection.id);

    const deleteApp = await createTestApp([notionPart.provider]);
    const deleted = await deleteApp.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });
    expect(deleted.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      namespace: connection.id,
    });

    const second = await app.inject({
      method: 'POST',
      url: '/integrations/notion-connections',
      payload: {
        workspace_id: context.workspaceId,
        notion_workspace_id: notionWorkspaceId,
        workspace_name: 'Acme',
        bot_id: botId,
        authorized_by_user_id: authorizedByUserId,
        access_token: 'replacement-token',
        display_name: 'Notion Acme',
      },
    });
    expect(second.statusCode).toBe(201);
    const secondConnection = second.json();
    await expect(
      listIntegrationConnections({workspaceId: context.workspaceId}),
    ).resolves.toHaveLength(1);

    const deletedSecond = await deleteApp.inject({
      method: 'DELETE',
      url: `/integration-connections/${secondConnection.id}`,
      headers: {authorization: 'Bearer user'},
    });
    expect(deletedSecond.statusCode).toBe(204);

    await app.close();
    await deleteApp.close();
  });

  afterEach(async () => {
    await notionPackage.closeDb();
  });
});
