import {runMigrations} from '@shipfox/node-drizzle';
import {createApp} from '@shipfox/node-fastify';
import {getIntegrationConnectionById, listIntegrationConnections} from '#db/connections.js';
import {createTestApp, useIntegrationRouteTest} from '#test/route-utils.js';
import {discordProviderModule} from './discord.js';

async function loadDiscordProvider() {
  vi.stubEnv('DISCORD_APPLICATION_ID', 'discord-application-id');
  vi.stubEnv('DISCORD_OAUTH_CLIENT_SECRET', 'discord-client-secret');
  vi.stubEnv('DISCORD_OAUTH_REDIRECT_URL', 'https://example.test/discord/callback');
  vi.stubEnv('DISCORD_PUBLIC_KEY', 'discord-public-key');
  vi.stubEnv('DISCORD_BOT_TOKEN', 'discord-bot-token');
  vi.stubEnv('DISCORD_GATEWAY_ENABLED', 'false');
  const discordPackage = await import('@shipfox/api-integration-discord');
  const part = await discordProviderModule.load();
  if (!part.database) throw new Error('Discord provider database is not configured');
  await runMigrations(
    part.database.db(),
    part.database.migrationsPath,
    `__drizzle_migrations_${part.database.databaseNamespace}`,
  );
  return {part, discordPackage};
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Discord provider scaffold', () => {
  const context = useIntegrationRouteTest();

  it('deletes a guild installation so the same guild can be reinstalled', async () => {
    const {part, discordPackage} = await loadDiscordProvider();
    if (!part.e2eRoutes) throw new Error('Discord E2E routes are not configured');

    const seedApp = await createApp({routes: part.e2eRoutes, swagger: false});
    const guildId = `guild-${crypto.randomUUID()}`;
    const payload = {
      workspace_id: context.workspaceId,
      guild_id: guildId,
      guild_name: 'Acme Discord',
      permissions: '309237730368',
      bot_role_id: 'role-1',
    };

    const first = await seedApp.inject({
      method: 'POST',
      url: '/integrations/discord-connections',
      payload,
    });
    expect(first.statusCode).toBe(201);

    const firstInstallation = await discordPackage.getDiscordInstallationByGuildId(guildId);
    expect(firstInstallation?.generation).toBe(1);

    const reconnected = await seedApp.inject({
      method: 'POST',
      url: '/integrations/discord-connections',
      payload,
    });
    expect(reconnected.statusCode).toBe(201);
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toMatchObject({
      generation: 2,
    });

    const deleteApp = await createTestApp([part.provider]);
    const connectionId = first.json().id as string;
    const deleted = await deleteApp.inject({
      method: 'DELETE',
      url: `/integration-connections/${connectionId}`,
      headers: {authorization: 'Bearer user'},
    });
    expect(deleted.statusCode).toBe(204);

    await expect(getIntegrationConnectionById(connectionId)).resolves.toBeUndefined();
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toBeUndefined();

    const second = await seedApp.inject({
      method: 'POST',
      url: '/integrations/discord-connections',
      payload,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().provider).toBe('discord');
    await expect(
      listIntegrationConnections({workspaceId: context.workspaceId}),
    ).resolves.toHaveLength(1);
  });
});
