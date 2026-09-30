import type {DiscordAgentToolId} from '@shipfox/api-integration-discord-dto';
import type {DiscordApiClient} from '#api/client.js';
import type {DiscordChannelGuard} from '#core/channel-guard.js';

export interface DiscordToolContext {
  discord: Pick<DiscordApiClient, 'getChannel' | 'listChannelMessages'>;
  guildId: string;
  guard: DiscordChannelGuard;
}

export interface DiscordToolOperation {
  /** Named in the answer to a `403`, so an admin knows what to grant the bot in the channel. */
  permissionHint: string;
  run(args: Record<string, unknown>, context: DiscordToolContext): Promise<Record<string, unknown>>;
}

export const DISCORD_TOOL_OPERATIONS: Partial<Record<DiscordAgentToolId, DiscordToolOperation>> = {
  read_channel: {
    permissionHint: 'View Channel and Read Message History',
    async run(args, {discord, guildId, guard}) {
      const channelId = stringArgument(args, 'channel_id');
      await guard({channelId, guildId});
      const messages = await discord.listChannelMessages({
        channelId,
        limit: optionalNumber(args.limit),
        before: optionalString(args.before),
        after: optionalString(args.after),
      });
      return {
        messages: messages.map((message) => ({
          ...message,
          url: discordMessageUrl({guildId, channelId, messageId: message.id}),
        })),
      };
    },
  },
};

export function discordMessageUrl(input: {
  guildId: string;
  channelId: string;
  messageId: string;
}): string {
  return `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === 'string' ? value : String(value ?? '');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
