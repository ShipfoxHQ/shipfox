import {setTimeout as sleep} from 'node:timers/promises';
import {runMigrations} from '@shipfox/node-drizzle';
import {createApp} from '@shipfox/node-fastify';
import {openPostgresSession} from '@shipfox/node-postgres';
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
  const part = await discordProviderModule.load({
    requireActiveWorkspaceMembership: () => Promise.resolve(),
  });
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
  vi.unstubAllGlobals();
});

describe('Discord provider scaffold', () => {
  const context = useIntegrationRouteTest();

  it('registers the interactions processor and the install routes', async () => {
    const {part} = await loadDiscordProvider();

    expect(part.webhookProcessors).toEqual([
      expect.objectContaining({routeIds: ['discord.interaction']}),
    ]);
    expect(part.provider.routes).toHaveLength(2);
  });

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

  it('leaves the guild after the records commit, under the guild lock', async () => {
    const {part, discordPackage} = await loadDiscordProvider();
    if (!part.e2eRoutes) throw new Error('Discord E2E routes are not configured');
    const seedApp = await createApp({routes: part.e2eRoutes, swagger: false});
    const guildId = `guild-${crypto.randomUUID()}`;
    const created = await seedApp.inject({
      method: 'POST',
      url: '/integrations/discord-connections',
      payload: {
        workspace_id: context.workspaceId,
        guild_id: guildId,
        guild_name: 'Acme Discord',
        permissions: '309237730368',
        bot_role_id: 'role-1',
      },
    });
    const connectionId = created.json().id as string;

    const observed: {url: string; method: string; recordsGone: boolean; lockHeld: boolean}[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | URL) => {
        const request = input as Request;
        const session = await openPostgresSession();
        try {
          const lock = await session.query<{acquired: boolean}>(
            'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
            [discordPackage.discordGuildLockKey(guildId)],
          );
          observed.push({
            url: request.url,
            method: request.method,
            recordsGone:
              (await getIntegrationConnectionById(connectionId)) === undefined &&
              (await discordPackage.getDiscordInstallationByGuildId(guildId)) === undefined,
            lockHeld: lock.rows[0]?.acquired !== true,
          });
        } finally {
          await session.end();
        }
        return new Response(null, {status: 204});
      }),
    );

    const deleteApp = await createTestApp([part.provider]);
    const deleted = await deleteApp.inject({
      method: 'DELETE',
      url: `/integration-connections/${connectionId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(deleted.statusCode).toBe(204);
    expect(observed).toEqual([
      {
        url: expect.stringContaining(`/users/@me/guilds/${guildId}`),
        method: 'DELETE',
        recordsGone: true,
        lockHeld: true,
      },
    ]);
  });

  it.each([403, 404])('counts a %s from Discord as a completed leave', async (status) => {
    const {part} = await loadDiscordProvider();
    if (!part.e2eRoutes) throw new Error('Discord E2E routes are not configured');
    const seedApp = await createApp({routes: part.e2eRoutes, swagger: false});
    const guildId = `guild-${crypto.randomUUID()}`;
    const created = await seedApp.inject({
      method: 'POST',
      url: '/integrations/discord-connections',
      payload: {
        workspace_id: context.workspaceId,
        guild_id: guildId,
        guild_name: 'Acme Discord',
        permissions: '309237730368',
        bot_role_id: 'role-1',
      },
    });
    const fetchMock = vi.fn(async (_input: Request | URL) => new Response('{}', {status}));
    vi.stubGlobal('fetch', fetchMock);

    const deleteApp = await createTestApp([part.provider]);
    const deleted = await deleteApp.inject({
      method: 'DELETE',
      url: `/integration-connections/${created.json().id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(deleted.statusCode).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('DELETE');
    expect(request.url).toContain(`/users/@me/guilds/${guildId}`);
  });
});

const API_VERSION_PREFIX_RE = /^\/api\/[^/]+/;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {promise, resolve};
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

/** A Discord REST fake where leaving the guild removes the bot, with hooks to pause a call. */
function fakeDiscord(input: {
  guildId: string;
  applicationId: string;
  beforeGetGuild?: () => Promise<void>;
  beforeLeave?: () => Promise<void>;
}) {
  const state = {botInGuild: true, calls: [] as string[]};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | URL) => {
      const {method, url} = request as Request;
      const call = `${method} ${new URL(url).pathname.replace(API_VERSION_PREFIX_RE, '')}`;
      state.calls.push(call);
      if (call === 'POST /oauth2/token') {
        return json({access_token: 'user-token', guild: {id: input.guildId, name: 'Acme'}});
      }
      if (call === 'POST /oauth2/token/revoke') return json({});
      if (call === `GET /guilds/${input.guildId}`) {
        await input.beforeGetGuild?.();
        if (!state.botInGuild) return json({code: 10004, message: 'Unknown Guild'}, 404);
        return json({
          id: input.guildId,
          name: 'Acme',
          roles: [
            {
              id: 'bot-role',
              name: 'Shipfox',
              managed: true,
              permissions: '309237730368',
              tags: {bot_id: input.applicationId},
            },
          ],
        });
      }
      if (call === `DELETE /users/@me/guilds/${input.guildId}`) {
        await input.beforeLeave?.();
        state.botInGuild = false;
        return new Response(null, {status: 204});
      }
      throw new Error(`Unexpected Discord call: ${call}`);
    }),
  );
  return state;
}

describe('Discord OAuth connect', () => {
  const context = useIntegrationRouteTest();

  async function setup() {
    const {part, discordPackage} = await loadDiscordProvider();
    if (!part.e2eRoutes) throw new Error('Discord E2E routes are not configured');
    const guildId = `guild-${crypto.randomUUID()}`;
    const app = await createTestApp([part.provider]);
    const state = () =>
      discordPackage.signDiscordInstallState({
        workspaceId: context.workspaceId,
        userId: 'user-1',
        nonce: 'browser-nonce-1',
      });
    const callback = () =>
      app.inject({
        method: 'GET',
        url: `/integrations/discord/callback/api?${new URLSearchParams({code: 'code-1', state: state()})}`,
        headers: {
          authorization: 'Bearer user',
          cookie: 'shipfox_discord_install_state=browser-nonce-1',
        },
      });
    const deleteConnection = (connectionId: string) =>
      app.inject({
        method: 'DELETE',
        url: `/integration-connections/${connectionId}`,
        headers: {authorization: 'Bearer user'},
      });
    const seedConnection = async (workspaceId = context.workspaceId) => {
      const seedApp = await createApp({routes: part.e2eRoutes ?? [], swagger: false});
      const created = await seedApp.inject({
        method: 'POST',
        url: '/integrations/discord-connections',
        payload: {
          workspace_id: workspaceId,
          guild_id: guildId,
          guild_name: 'Acme',
          permissions: '309237730368',
          bot_role_id: 'old-role',
        },
      });
      return created.json().id as string;
    };
    const discord = (
      hooks: {beforeGetGuild?: () => Promise<void>; beforeLeave?: () => Promise<void>} = {},
    ) =>
      fakeDiscord({guildId, applicationId: discordPackage.config.DISCORD_APPLICATION_ID, ...hooks});
    return {discordPackage, guildId, callback, deleteConnection, seedConnection, discord};
  }

  it('connects a new server, then reconnects it with a bumped generation', async () => {
    const {discordPackage, guildId, callback, discord} = await setup();
    discord();

    const first = await callback();

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      outcome: 'connected',
      connection: {
        provider: 'discord',
        workspace_id: context.workspaceId,
        external_account_id: guildId,
        lifecycle_status: 'active',
      },
    });
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toMatchObject({
      status: 'installed',
      guildName: 'Acme',
      permissions: '309237730368',
      botRoleId: 'bot-role',
      generation: 1,
    });

    const second = await callback();

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      outcome: 'reconnected',
      connection: {id: first.json().connection.id},
    });
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toMatchObject({
      generation: 2,
    });
    await expect(
      listIntegrationConnections({workspaceId: context.workspaceId}),
    ).resolves.toHaveLength(1);
  });

  it('rejects a server that another workspace holds and leaves it untouched', async () => {
    const {discordPackage, guildId, callback, seedConnection, discord} = await setup();
    discord();
    await seedConnection(crypto.randomUUID());

    const res = await callback();

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('discord-installation-already-linked');
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toMatchObject({
      generation: 1,
      botRoleId: 'old-role',
    });
  });

  it('fails the install with bot-not-in-guild when a delete commits first, then connects once the bot is re-added', async () => {
    const {discordPackage, guildId, callback, deleteConnection, seedConnection, discord} =
      await setup();
    const connectionId = await seedConnection();
    const leaveStarted = deferred();
    const releaseLeave = deferred();
    const fake = discord({
      beforeLeave: async () => {
        leaveStarted.resolve();
        await releaseLeave.promise;
      },
    });

    const deletion = deleteConnection(connectionId);
    await leaveStarted.promise;
    // The records are gone and the delete is paused before leaving the guild.
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toBeUndefined();
    const reinstall = callback();
    await vi.waitFor(() => expect(fake.calls).toContain('POST /oauth2/token/revoke'));
    await sleep(150);
    expect(fake.calls).not.toContain(`GET /guilds/${guildId}`);
    releaseLeave.resolve();
    const [deleted, failed] = await Promise.all([deletion, reinstall]);

    expect(deleted.statusCode).toBe(204);
    expect(failed.statusCode).toBe(422);
    expect(failed.json().code).toBe('discord-bot-not-in-guild');
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toBeUndefined();
    await expect(
      listIntegrationConnections({workspaceId: context.workspaceId}),
    ).resolves.toHaveLength(0);

    fake.botInGuild = true;
    const retried = await callback();

    expect(retried.statusCode).toBe(200);
    expect(retried.json().outcome).toBe('connected');
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toMatchObject({
      status: 'installed',
    });
    expect(fake.botInGuild).toBe(true);
  });

  it('runs a delete queued behind an install after the install commits, leaving no records and no bot', async () => {
    const {discordPackage, guildId, callback, deleteConnection, seedConnection, discord} =
      await setup();
    const connectionId = await seedConnection();
    const getGuildStarted = deferred();
    const releaseGetGuild = deferred();
    const fake = discord({
      beforeGetGuild: async () => {
        getGuildStarted.resolve();
        await releaseGetGuild.promise;
      },
    });

    const reinstall = callback();
    await getGuildStarted.promise;
    const deletion = deleteConnection(connectionId);
    await sleep(150);
    // The delete waits on the guild lock, so the bot has not been asked to leave.
    expect(fake.calls).not.toContain(`DELETE /users/@me/guilds/${guildId}`);
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toMatchObject({
      generation: 1,
    });
    releaseGetGuild.resolve();
    const [reinstalled, deleted] = await Promise.all([reinstall, deletion]);

    expect(reinstalled.statusCode).toBe(200);
    expect(reinstalled.json().outcome).toBe('reconnected');
    expect(deleted.statusCode).toBe(204);
    expect(fake.calls.indexOf(`GET /guilds/${guildId}`)).toBeLessThan(
      fake.calls.indexOf(`DELETE /users/@me/guilds/${guildId}`),
    );
    expect(fake.botInGuild).toBe(false);
    await expect(discordPackage.getDiscordInstallationByGuildId(guildId)).resolves.toBeUndefined();
    await expect(
      listIntegrationConnections({workspaceId: context.workspaceId}),
    ).resolves.toHaveLength(0);
  });
});
