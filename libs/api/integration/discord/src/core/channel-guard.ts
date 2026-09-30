import type {DiscordApiClient} from '#api/client.js';
import {DiscordIntegrationProviderError} from '#core/errors.js';

export interface DiscordGuardedChannel {
  type: number;
  parentId: string | null;
}

export type DiscordChannelGuard = (input: {
  channelId: string;
  guildId: string;
}) => Promise<DiscordGuardedChannel>;

/**
 * The bot token reaches every server the bot is in, so a channel-scoped call must first prove the
 * channel belongs to the connection's guild. A channel never moves between guilds, so answers are
 * cached for the life of the process, and a failed lookup is never cached.
 */
export function createDiscordChannelGuard(discord: Pick<DiscordApiClient, 'getChannel'>) {
  const channels = new Map<string, DiscordGuardedChannel & {guildId: string | null}>();

  const guard: DiscordChannelGuard = async ({channelId, guildId}) => {
    let known = channels.get(channelId);
    if (known === undefined) {
      const channel = await discord.getChannel({channelId});
      known = {
        guildId: channel.guild_id ?? null,
        type: channel.type,
        parentId: channel.parent_id ?? null,
      };
      channels.set(channelId, known);
    }
    if (known.guildId === null) {
      throw new DiscordIntegrationProviderError({
        reason: 'access-denied',
        message: 'Direct message channels are not supported',
      });
    }
    if (known.guildId !== guildId) {
      // Same answer as a missing channel, so a channel ID in another server is not confirmed.
      throw new DiscordIntegrationProviderError({
        reason: 'not-found',
        message: 'Channel not found in this server',
      });
    }
    return {type: known.type, parentId: known.parentId};
  };
  return guard;
}
