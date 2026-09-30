import {createDiscordApiClient, type DiscordApiClient} from '#api/client.js';
import {recordDiscordGatewayDispatch} from '#metrics/index.js';
import {createDiscordChannelCache} from './channel-cache.js';
import type {DispatchHandlers} from './gateway-dispatch-queue.js';
import {
  createDiscordGuildLifecycle,
  type DiscordGuildLifecycleOptions,
} from './gateway-guild-lifecycle.js';
import {type DiscordMessageHandlerOptions, handleDiscordMessageCreate} from './message-create.js';

export interface CreateDiscordGatewayHandlersOptions
  extends Omit<DiscordMessageHandlerOptions, 'channels'>,
    Pick<DiscordGuildLifecycleOptions, 'updateConnectionLifecycleStatus'> {
  /** Used for a channel the cache has not seen and for the guild removal check. Defaults to the configured client. */
  discord?: Pick<DiscordApiClient, 'getChannel' | 'getGuild'> | undefined;
}

/** The dispatches the leader acts on, sharing one channel cache. */
export function createDiscordGatewayHandlers(
  options: CreateDiscordGatewayHandlersOptions,
): DispatchHandlers {
  const {discord, updateConnectionLifecycleStatus, ...messageOptions} = options;
  const lifecycle = createDiscordGuildLifecycle({
    coreDb: options.coreDb,
    updateConnectionLifecycleStatus,
    discord,
  });
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
    ...lifecycle.handlers,
    GUILD_CREATE: async (payload) => {
      rememberAll(asRecord(payload.d)?.channels);
      rememberAll(asRecord(payload.d)?.threads);
      await lifecycle.handlers.GUILD_CREATE?.(payload);
    },
    THREAD_LIST_SYNC: ({d}) => rememberAll(asRecord(d)?.threads),
    CHANNEL_CREATE: remember,
    CHANNEL_UPDATE: remember,
    THREAD_CREATE: remember,
    THREAD_UPDATE: remember,
    CHANNEL_DELETE: forget,
    THREAD_DELETE: forget,
    MESSAGE_CREATE: async ({d}) => {
      const outcome = await handleDiscordMessageCreate({...messageOptions, channels}, d);
      // A failure is recorded by the dispatch queue, and an ignored message has no metric label.
      if (outcome !== 'ignored') recordDiscordGatewayDispatch({event: 'message_create', outcome});
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
