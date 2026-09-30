import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import type {DiscordApiClient} from '#api/client.js';
import {isDiscordThreadType} from '#core/channel-types.js';

const channelSchema = z
  .object({
    id: z.string().min(1),
    type: z.number().int(),
    parent_id: z.string().min(1).nullish(),
  })
  .passthrough();

export interface ChannelPlacement {
  isThread: boolean;
  /** The channel a thread lives in, or the forum for a forum post. Null for a top-level channel. */
  parentId: string | null;
}

export interface DiscordChannelCache {
  /** Stores a channel or thread object from a dispatch or a REST answer. Malformed objects are ignored. */
  remember(channel: unknown): void;
  forget(channelId: string): void;
  /** Answers from the cache, then from one REST call. Undefined when Discord cannot say. */
  resolve(channelId: string): Promise<ChannelPlacement | undefined>;
}

/**
 * A channel's guild and parent never change, so entries never expire. They are dropped only when
 * the channel is deleted. The cache starts empty after a resume, because Discord does not resend
 * `GUILD_CREATE` then, and fills through the REST fallback on the first miss per channel.
 */
export function createDiscordChannelCache(params: {
  getChannel: DiscordApiClient['getChannel'];
}): DiscordChannelCache {
  const channels = new Map<string, ChannelPlacement>();

  function remember(channel: unknown): void {
    const parsed = channelSchema.safeParse(channel);
    if (!parsed.success) return;
    channels.set(parsed.data.id, {
      isThread: isDiscordThreadType(parsed.data.type),
      parentId: parsed.data.parent_id ?? null,
    });
  }

  return {
    remember,
    forget: (channelId) => {
      channels.delete(channelId);
    },
    async resolve(channelId) {
      const cached = channels.get(channelId);
      if (cached) return cached;
      try {
        remember(await params.getChannel({channelId}));
      } catch (error) {
        logger().warn({err: error, channelId}, 'discord channel lookup failed');
        return undefined;
      }
      return channels.get(channelId);
    },
  };
}
