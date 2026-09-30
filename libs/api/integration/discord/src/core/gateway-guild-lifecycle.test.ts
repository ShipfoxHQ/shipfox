import type {GatewayDispatchPayload} from 'discord-api-types/v10';
import type {DiscordGuild} from '#api/client.js';
import {db} from '#db/db.js';
import {getDiscordInstallationByGuildId, upsertDiscordInstallation} from '#db/installations.js';
import {discordInstallations} from '#db/schema/installations.js';
import {APPLICATION_ID, BOT_ROLE_ID, GUILD_ID} from '#test/index.js';
import {DiscordIntegrationProviderError} from './errors.js';
import {createDiscordGuildLifecycle} from './gateway-guild-lifecycle.js';

const CONNECTION_ID = '0198c7a0-0000-7000-8000-000000000001';

function guildAnswer(): DiscordGuild {
  return {id: GUILD_ID, name: 'Acme', roles: []};
}

function providerError(status: number) {
  return new DiscordIntegrationProviderError({
    reason: status === 404 ? 'not-found' : 'provider-unavailable',
    message: `Discord answered ${status}`,
    status,
  });
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {promise, resolve};
}

function dispatch(t: string, d: unknown): GatewayDispatchPayload {
  return {op: 0, s: 1, t, d} as unknown as GatewayDispatchPayload;
}

function arrange(options: {getGuild: () => Promise<DiscordGuild>}) {
  const updateConnectionLifecycleStatus = vi.fn(() => Promise.resolve(undefined));
  const lifecycle = createDiscordGuildLifecycle({
    coreDb: db,
    updateConnectionLifecycleStatus,
    discord: {getGuild: vi.fn(options.getGuild)},
    applicationId: APPLICATION_ID,
  });
  return {lifecycle, updateConnectionLifecycleStatus};
}

async function install(status: 'installed' | 'removed' = 'installed') {
  return await upsertDiscordInstallation({
    connectionId: CONNECTION_ID,
    guildId: GUILD_ID,
    guildName: 'Acme',
    permissions: '0',
    botRoleId: BOT_ROLE_ID,
    status,
  });
}

async function installationStatus() {
  return (await getDiscordInstallationByGuildId(GUILD_ID))?.status;
}

describe('Discord guild lifecycle', () => {
  beforeEach(async () => {
    await db().delete(discordInstallations);
  });

  describe('READY', () => {
    it('removes an installed guild that is absent and confirmed gone by Discord', async () => {
      await install();
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: () => Promise.reject(providerError(404)),
      });

      await lifecycle.handlers.READY?.(
        dispatch('READY', {guilds: [{id: 'other', unavailable: true}]}),
      );

      expect(await installationStatus()).toBe('removed');
      expect(updateConnectionLifecycleStatus).toHaveBeenCalledWith(
        {id: CONNECTION_ID, lifecycleStatus: 'error'},
        {tx: expect.anything()},
      );
    });

    it('does not check a guild the bot is still in', async () => {
      await install();
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: () => Promise.reject(providerError(404)),
      });

      await lifecycle.handlers.READY?.(
        dispatch('READY', {guilds: [{id: GUILD_ID, unavailable: true}]}),
      );

      expect(await installationStatus()).toBe('installed');
      expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    });

    it('keeps an absent guild that Discord still returns', async () => {
      await install();
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: () => Promise.resolve(guildAnswer()),
      });

      await lifecycle.handlers.READY?.(dispatch('READY', {guilds: []}));

      expect(await installationStatus()).toBe('installed');
      expect(updateConnectionLifecycleStatus).toHaveBeenCalledWith(
        {id: CONNECTION_ID, lifecycleStatus: 'active'},
        {tx: expect.anything()},
      );
    });

    it('leaves both records alone when Discord answers with another error', async () => {
      await install();
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: () => Promise.reject(providerError(500)),
      });

      await lifecycle.handlers.READY?.(dispatch('READY', {guilds: []}));

      expect(await installationStatus()).toBe('installed');
      expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    });
  });

  describe('GUILD_DELETE', () => {
    it('removes the guild when the bot was removed', async () => {
      await install();
      const {lifecycle} = arrange({getGuild: () => Promise.reject(providerError(403))});

      await lifecycle.handlers.GUILD_DELETE?.(dispatch('GUILD_DELETE', {id: GUILD_ID}));

      expect(await installationStatus()).toBe('removed');
    });

    it('ignores an outage', async () => {
      await install();
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: () => Promise.reject(providerError(404)),
      });

      await lifecycle.handlers.GUILD_DELETE?.(
        dispatch('GUILD_DELETE', {id: GUILD_ID, unavailable: true}),
      );

      expect(await installationStatus()).toBe('installed');
      expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    });

    it('ignores a guild without an installation', async () => {
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: () => Promise.reject(providerError(404)),
      });

      await lifecycle.handlers.GUILD_DELETE?.(dispatch('GUILD_DELETE', {id: 'unknown'}));

      expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    });
  });

  describe('GUILD_CREATE', () => {
    it('restores a removed installation when the bot is back', async () => {
      await install('removed');
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: () => Promise.resolve(guildAnswer()),
      });

      await lifecycle.handlers.GUILD_CREATE?.(dispatch('GUILD_CREATE', {id: GUILD_ID, roles: []}));

      expect(await installationStatus()).toBe('installed');
      expect(updateConnectionLifecycleStatus).toHaveBeenCalledWith(
        {id: CONNECTION_ID, lifecycleStatus: 'active'},
        {tx: expect.anything()},
      );
    });

    it('does not ask Discord about an installed guild', async () => {
      await install();
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: () => Promise.reject(providerError(404)),
      });

      await lifecycle.handlers.GUILD_CREATE?.(dispatch('GUILD_CREATE', {id: GUILD_ID, roles: []}));

      expect(await installationStatus()).toBe('installed');
      expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    });

    it("writes the bot's managed role when it differs", async () => {
      await install();
      const {lifecycle} = arrange({getGuild: () => Promise.resolve(guildAnswer())});

      await lifecycle.handlers.GUILD_CREATE?.(
        dispatch('GUILD_CREATE', {
          id: GUILD_ID,
          roles: [
            {id: 'role-other-bot', tags: {bot_id: 'another-app'}},
            {id: 'role-new', tags: {bot_id: APPLICATION_ID}},
          ],
        }),
      );

      expect((await getDiscordInstallationByGuildId(GUILD_ID))?.botRoleId).toBe('role-new');
    });
  });

  describe.each(['GUILD_ROLE_CREATE', 'GUILD_ROLE_UPDATE'])('%s', (name) => {
    it("writes the role that belongs to the bot's application", async () => {
      await install();
      const {lifecycle} = arrange({getGuild: () => Promise.resolve(guildAnswer())});

      await lifecycle.handlers[name]?.(
        dispatch(name, {
          guild_id: GUILD_ID,
          role: {id: 'role-new', tags: {bot_id: APPLICATION_ID}},
        }),
      );

      expect((await getDiscordInstallationByGuildId(GUILD_ID))?.botRoleId).toBe('role-new');
    });

    it('ignores a role that belongs to another application or to no bot', async () => {
      await install();
      const {lifecycle} = arrange({getGuild: () => Promise.resolve(guildAnswer())});

      await lifecycle.handlers[name]?.(
        dispatch(name, {guild_id: GUILD_ID, role: {id: 'role-a', tags: {bot_id: 'another-app'}}}),
      );
      await lifecycle.handlers[name]?.(dispatch(name, {guild_id: GUILD_ID, role: {id: 'role-b'}}));

      expect((await getDiscordInstallationByGuildId(GUILD_ID))?.botRoleId).toBe(BOT_ROLE_ID);
    });
  });

  describe('removal check against a reconnect', () => {
    it('does not overwrite a reinstall that committed between the read and the write', async () => {
      await install();
      const guildRequested = deferred();
      const reconnectCommitted = deferred();
      const {lifecycle, updateConnectionLifecycleStatus} = arrange({
        getGuild: async () => {
          guildRequested.resolve();
          await reconnectCommitted.promise;
          throw providerError(404);
        },
      });

      const check = lifecycle.checkGuildRemoval({guildId: GUILD_ID});
      await guildRequested.promise;
      const reinstalled = await install();
      reconnectCommitted.resolve();
      await check;

      const installation = await getDiscordInstallationByGuildId(GUILD_ID);
      expect(installation).toMatchObject({status: 'installed', generation: reinstalled.generation});
      expect(reinstalled.generation).toBe(2);
      expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    });
  });
});
