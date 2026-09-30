import type {DiscordApiClient} from '#api/client.js';
import {DiscordIntegrationProviderError} from '#core/errors.js';

export type DiscordChannelGuard = (input: {channelId: string; guildId: string}) => Promise<void>;

/**
 * The bot token reaches every server the bot is in, so a channel-scoped call must first prove the
 * channel belongs to the connection's guild. A channel never moves between guilds, so answers are
 * cached for the life of the process, and a failed lookup is never cached.
 */
export function createDiscordChannelGuard(discord: Pick<DiscordApiClient, 'getChannel'>) {
  const guildByChannel = new Map<string, string | null>();

  const guard: DiscordChannelGuard = async ({channelId, guildId}) => {
    let channelGuildId = guildByChannel.get(channelId);
    if (channelGuildId === undefined) {
      const channel = await discord.getChannel({channelId});
      channelGuildId = channel.guild_id ?? null;
      guildByChannel.set(channelId, channelGuildId);
    }
    if (channelGuildId === null) {
      throw new DiscordIntegrationProviderError({
        reason: 'access-denied',
        message: 'Direct message channels are not supported',
      });
    }
    if (channelGuildId !== guildId) {
      // Same answer as a missing channel, so a channel ID in another server is not confirmed.
      throw new DiscordIntegrationProviderError({
        reason: 'not-found',
        message: 'Channel not found in this server',
      });
    }
  };
  return guard;
}
