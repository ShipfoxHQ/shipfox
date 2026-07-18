import {
  getSlackInstallationByConnectionId,
  upsertSlackInstallation,
} from '@shipfox/api-integration-slack';
import {runMigrations} from '@shipfox/node-drizzle';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';

describe('slackProviderModule', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads its database descriptor and persists a core connection with its Slack installation', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_SLACK_PROVIDER', 'true');
    vi.resetModules();
    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();
    const slackPart = parts.find((part) => part.provider.provider === 'slack');
    if (!slackPart?.database) throw new Error('Slack provider database is not configured');
    const workspaceId = crypto.randomUUID();
    const teamId = `T${crypto.randomUUID()}`;

    await runMigrations(
      slackPart.database.db(),
      slackPart.database.migrationsPath,
      slackPart.database.migrationsTableName,
    );
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'slack',
      externalAccountId: teamId,
      slug: `slack_${teamId}`,
      displayName: 'Slack Acme',
    });
    await upsertSlackInstallation({
      connectionId: connection.id,
      teamId,
      teamName: 'Acme',
      appId: 'A123',
      botUserId: 'U123',
      scopes: ['app_mentions:read'],
      status: 'installed',
    });

    await expect(getIntegrationConnectionById(connection.id)).resolves.toMatchObject({
      id: connection.id,
      provider: 'slack',
    });
    await expect(getSlackInstallationByConnectionId(connection.id)).resolves.toMatchObject({
      connectionId: connection.id,
      teamId,
    });
  });
});
