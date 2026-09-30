import {createDiscordApiClient, type DiscordApiClient} from '#api/client.js';
import {createDiscordChannelCache} from './channel-cache.js';
import type {DispatchHandlers} from './gateway-dispatch-queue.js';
import {type DiscordMessageHandlerOptions, handleDiscordMessageCreate} from './message-create.js';

export interface CreateDiscordGatewayHandlersOptions
  extends Omit<DiscordMessageHandlerOptions, 'channels'> {
  /** Only `getChannel` is used, for a channel the cache has not seen. Defaults to the configured client. */
  discord?: Pick<DiscordApiClient, 'getChannel'> | undefined;
}

/** The dispatches the leader acts on, sharing one channel cache. */
export function createDiscordGatewayHandlers(
  options: CreateDiscordGatewayHandlersOptions,
): DispatchHandlers {
  const {discord, ...messageOptions} = options;
  let client = discord;
  const channels = createDiscordChannelCache({
    getChannel: (input) => {
      client ??= createDiscordApiClient();
      return client.getChannel(input);
    },
  });
  const remember = (payload: {d: unknown}) => channels.remember(payload.d);
  const forget = (payload: {d: unknown}) => {
    const id = asRecord(payload.d)?.id;
    if (typeof id === 'string') channels.forget(id);
  };
  const rememberAll = (channelList: unknown) => {
    if (Array.isArray(channelList)) for (const channel of channelList) channels.remember(channel);
  };

  return {
    GUILD_CREATE: ({d}) => {
      rememberAll(asRecord(d)?.channels);
      rememberAll(asRecord(d)?.threads);
    },
    THREAD_LIST_SYNC: ({d}) => rememberAll(asRecord(d)?.threads),
    CHANNEL_CREATE: remember,
    CHANNEL_UPDATE: remember,
    THREAD_CREATE: remember,
    THREAD_UPDATE: remember,
    CHANNEL_DELETE: forget,
    THREAD_DELETE: forget,
    MESSAGE_CREATE: async ({d}) => {
      await handleDiscordMessageCreate({...messageOptions, channels}, d);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
