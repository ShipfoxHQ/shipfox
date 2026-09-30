import type {
  IntegrationConnectionLifecycleStatus,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {
  GatewayGuildCreateDispatchData,
  GatewayGuildDeleteDispatchData,
  GatewayGuildRoleCreateDispatchData,
  GatewayGuildRoleUpdateDispatchData,
  GatewayReadyDispatchData,
} from 'discord-api-types/v10';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createDiscordApiClient, type DiscordApiClient} from '#api/client.js';
import {config} from '#config.js';
import {
  type DiscordInstallationStatus,
  getDiscordInstallationByGuildId,
  listInstalledDiscordGuildIds,
  setDiscordInstallationBotRoleId,
  updateDiscordInstallationStatusAtGeneration,
} from '#db/installations.js';
import {DiscordIntegrationProviderError} from './errors.js';
import type {DispatchHandlers, GatewayDispatchPayload} from './gateway-dispatch-queue.js';

export interface DiscordGuildLifecycleOptions {
  /** The database the connections live in, so the installation and connection update share a transaction. */
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
  discord?: Pick<DiscordApiClient, 'getGuild'> | undefined;
  applicationId?: string | undefined;
}

export interface DiscordGuildLifecycle {
  handlers: DispatchHandlers;
  /** Confirms over REST whether the bot is still in the guild, then records the answer. */
  checkGuildRemoval(params: {guildId: string}): Promise<void>;
}

const OUTCOMES: Record<
  'present' | 'gone',
  {installation: DiscordInstallationStatus; connection: IntegrationConnectionLifecycleStatus}
> = {
  present: {installation: 'installed', connection: 'active'},
  gone: {installation: 'removed', connection: 'error'},
};

export function createDiscordGuildLifecycle(
  options: DiscordGuildLifecycleOptions,
): DiscordGuildLifecycle {
  let discord = options.discord;
  const applicationId = () => options.applicationId ?? config.DISCORD_APPLICATION_ID;

  /**
   * A Gateway event can arrive after a reinstall, and a REST answer alone cannot order the two: the
   * check may read `404`, a reconnect may commit, and the check would then overwrite the fresh
   * installation. Writing only while the generation is unchanged closes that race.
   */
  async function checkGuildRemoval({guildId}: {guildId: string}): Promise<void> {
    const installation = await getDiscordInstallationByGuildId(guildId);
    if (!installation) return;

    const outcome = await readGuildOutcome(guildId);
    if (!outcome) return;

    await options.coreDb().transaction(async (tx) => {
      const matched = await updateDiscordInstallationStatusAtGeneration(
        {guildId, generation: installation.generation, status: outcome.installation},
        {tx},
      );
      if (!matched) return;
      await options.updateConnectionLifecycleStatus(
        {id: installation.connectionId, lifecycleStatus: outcome.connection},
        {tx},
      );
    });
  }

  /** Any answer other than present or gone leaves the state alone; the next `READY` retries. */
  async function readGuildOutcome(
    guildId: string,
  ): Promise<(typeof OUTCOMES)[keyof typeof OUTCOMES] | undefined> {
    discord ??= createDiscordApiClient();
    try {
      await discord.getGuild({guildId});
      return OUTCOMES.present;
    } catch (error) {
      if (
        error instanceof DiscordIntegrationProviderError &&
        (error.status === 403 || error.status === 404)
      ) {
        return OUTCOMES.gone;
      }
      logger().warn({err: error, guildId}, 'Discord guild removal check could not reach Discord');
      return undefined;
    }
  }

  async function writeBotRole(params: {guildId: string; botRoleId: string}): Promise<void> {
    await setDiscordInstallationBotRoleId(params);
  }

  const handlers: DispatchHandlers = {
    READY: async (payload) => {
      const ready = dataOf<GatewayReadyDispatchData>(payload);
      const present = new Set(ready.guilds.map((guild) => guild.id));
      for (const guildId of await listInstalledDiscordGuildIds()) {
        if (!present.has(guildId)) await checkGuildRemoval({guildId});
      }
    },
    GUILD_CREATE: async (payload) => {
      const guild = dataOf<GatewayGuildCreateDispatchData>(payload);
      const installation = await getDiscordInstallationByGuildId(guild.id);
      if (!installation) return;
      const role = guild.roles?.find((candidate) => candidate.tags?.bot_id === applicationId());
      if (role) await writeBotRole({guildId: guild.id, botRoleId: role.id});
      // The bot was added again outside Shipfox.
      if (installation.status === 'removed') await checkGuildRemoval({guildId: guild.id});
    },
    GUILD_DELETE: async (payload) => {
      const guild = dataOf<GatewayGuildDeleteDispatchData>(payload);
      // An outage marks the guild unavailable, which says nothing about the bot's membership.
      if (guild.unavailable) return;
      await checkGuildRemoval({guildId: guild.id});
    },
    GUILD_ROLE_CREATE: (payload) => writeRoleDispatch(payload),
    GUILD_ROLE_UPDATE: (payload) => writeRoleDispatch(payload),
  };

  async function writeRoleDispatch(payload: GatewayDispatchPayload): Promise<void> {
    const {guild_id: guildId, role} = dataOf<
      GatewayGuildRoleCreateDispatchData | GatewayGuildRoleUpdateDispatchData
    >(payload);
    if (role.tags?.bot_id !== applicationId()) return;
    await writeBotRole({guildId, botRoleId: role.id});
  }

  return {handlers, checkGuildRemoval};
}

function dataOf<T>(payload: GatewayDispatchPayload): T {
  return payload.d as unknown as T;
}
