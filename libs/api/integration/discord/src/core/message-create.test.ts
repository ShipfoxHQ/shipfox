import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {DiscordChannel} from '#api/client.js';
import {db} from '#db/db.js';
import {upsertDiscordInstallation} from '#db/installations.js';
import {discordInstallations} from '#db/schema/installations.js';
import {BOT_ROLE_ID, fakeConnection, GUILD_ID} from '#test/index.js';
import {createDiscordChannelCache} from './channel-cache.js';
import {handleDiscordMessageCreate} from './message-create.js';

const BOT_USER_ID = 'bot-user';
const CHANNEL_ID = 'channel-1';
const THREAD_ID = 'thread-1';
const FORUM_ID = 'forum-1';

const channelsById: Record<string, DiscordChannel> = {
  [CHANNEL_ID]: {id: CHANNEL_ID, type: 0},
  [THREAD_ID]: {id: THREAD_ID, type: 11, parent_id: CHANNEL_ID},
  'forum-post-1': {id: 'forum-post-1', type: 11, parent_id: FORUM_ID},
};

const human = {id: 'user-1', username: 'ada'};

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `message-${randomUUID()}`,
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    author: human,
    content: 'hello',
    type: 0,
    mentions: [],
    mention_roles: [],
    ...overrides,
  };
}

async function arrange(
  options: {
    connection?: IntegrationConnection | undefined;
    installation?: 'installed' | 'removed' | 'none';
    botRoleId?: string | null;
    published?: boolean;
    getChannel?: (input: {channelId: string}) => Promise<DiscordChannel>;
  } = {},
) {
  const connection = options.connection ?? fakeConnection();
  if (options.installation !== 'none') {
    await upsertDiscordInstallation({
      connectionId: connection.id,
      guildId: GUILD_ID,
      guildName: 'Acme',
      permissions: '0',
      botRoleId: options.botRoleId === undefined ? BOT_ROLE_ID : options.botRoleId,
      status: options.installation ?? 'installed',
    });
  }
  const getChannel = vi.fn(
    options.getChannel ??
      (({channelId}: {channelId: string}) => {
        const channel = channelsById[channelId];
        return channel
          ? Promise.resolve(channel)
          : Promise.reject(new Error(`unknown channel ${channelId}`));
      }),
  );
  const publishIntegrationEventReceived = vi.fn(async (_params: {event: unknown}) => ({
    published: options.published ?? true,
  }));
  const handlerOptions = {
    coreDb: db,
    publishIntegrationEventReceived,
    getIntegrationConnectionById: vi.fn(async () => connection),
    channels: createDiscordChannelCache({getChannel}),
    botUserId: BOT_USER_ID,
  };
  const handle = (data: unknown) => handleDiscordMessageCreate(handlerOptions, data);
  const publishedEvent = () => {
    const call = publishIntegrationEventReceived.mock.calls[0]?.[0];
    if (!call) throw new Error('nothing was published');
    return call.event as {deliveryId: string; event: string; payload: Record<string, unknown>};
  };
  return {connection, handle, getChannel, publishIntegrationEventReceived, publishedEvent};
}

describe('Discord message_create ingestion', () => {
  beforeEach(async () => {
    await db().delete(discordInstallations);
  });

  describe('publishing', () => {
    it('publishes a channel message with the message id as the delivery id', async () => {
      const {connection, handle, publishedEvent} = await arrange();
      const incoming = message({id: 'message-1'});

      await expect(handle(incoming)).resolves.toBe('processed');

      expect(publishedEvent()).toMatchObject({
        provider: 'discord',
        source: connection.slug,
        event: 'message_create',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId: 'message-1',
      });
      expect(publishedEvent().payload).toMatchObject({
        id: 'message-1',
        content: 'hello',
        mentions_bot: false,
        root_channel_id: CHANNEL_ID,
        url: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/message-1`,
        author: {id: 'user-1', bot: false},
      });
      expect(publishedEvent().payload).not.toHaveProperty('thread_id');
    });

    it('reports a message the platform already has as a duplicate', async () => {
      const {handle} = await arrange({published: false});

      await expect(handle(message())).resolves.toBe('duplicate');
    });

    it('throws when publishing fails, so the committed mark stays below the dispatch', async () => {
      const {handle, publishIntegrationEventReceived} = await arrange();
      publishIntegrationEventReceived.mockRejectedValueOnce(new Error('database down'));

      await expect(handle(message())).rejects.toThrow('database down');
    });
  });

  describe('placement', () => {
    it('sets the thread id and the parent as root for a thread message', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(message({channel_id: THREAD_ID}));

      expect(publishedEvent().payload).toMatchObject({
        thread_id: THREAD_ID,
        root_channel_id: CHANNEL_ID,
      });
    });

    it('sets the forum as root for a forum post', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(message({id: 'forum-post-1', channel_id: 'forum-post-1'}));

      expect(publishedEvent().payload).toMatchObject({
        thread_id: 'forum-post-1',
        root_channel_id: FORUM_ID,
      });
    });

    it('asks Discord once per channel, then answers from the cache', async () => {
      const {handle, getChannel} = await arrange();

      await handle(message());
      await handle(message());

      expect(getChannel).toHaveBeenCalledTimes(1);
    });

    it('publishes without a root channel when Discord cannot resolve the channel', async () => {
      const {handle, publishedEvent} = await arrange({
        getChannel: () => Promise.reject(new Error('unavailable')),
      });

      await expect(handle(message({channel_id: THREAD_ID}))).resolves.toBe('processed');

      expect(publishedEvent().payload).not.toHaveProperty('root_channel_id');
      expect(publishedEvent().payload).not.toHaveProperty('thread_id');
    });

    it('publishes a thread without a root channel when its parent is unknown', async () => {
      const {handle, publishedEvent} = await arrange({
        getChannel: async () => ({id: THREAD_ID, type: 11}),
      });

      await handle(message({channel_id: THREAD_ID}));

      expect(publishedEvent().payload).toMatchObject({thread_id: THREAD_ID});
      expect(publishedEvent().payload).not.toHaveProperty('root_channel_id');
    });
  });

  describe('mentions_bot', () => {
    it('is true when the bot user is mentioned', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(message({mentions: [{id: BOT_USER_ID, bot: true}]}));

      expect(publishedEvent().payload.mentions_bot).toBe(true);
    });

    it('is true when only the managed role is mentioned', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(message({mentions: [], mention_roles: [BOT_ROLE_ID]}));

      expect(publishedEvent().payload.mentions_bot).toBe(true);
    });

    it('is false for another role and another user', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(message({mentions: [{id: 'user-2'}], mention_roles: ['role-other']}));

      expect(publishedEvent().payload.mentions_bot).toBe(false);
    });

    it('is true for a reply with the ping on, which lists the bot in mentions', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(
        message({
          type: 19,
          message_reference: {message_id: 'bot-message'},
          mentions: [{id: BOT_USER_ID, bot: true}],
        }),
      );

      expect(publishedEvent().payload.mentions_bot).toBe(true);
    });

    it('is false for a reply with the ping off, which lists nobody', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(message({type: 19, message_reference: {message_id: 'bot-message'}}));

      expect(publishedEvent().payload.mentions_bot).toBe(false);
    });

    it('is false for a role mention when the installation has no bot role yet', async () => {
      const {handle, publishedEvent} = await arrange({botRoleId: null});

      await handle(message({mention_roles: [BOT_ROLE_ID]}));

      expect(publishedEvent().payload.mentions_bot).toBe(false);
    });
  });

  describe('author.bot', () => {
    it('keeps an explicit bot flag', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(message({author: {...human, bot: true}}));

      expect(publishedEvent().payload.author).toMatchObject({id: 'user-1', bot: true});
    });

    it('turns a missing flag into false', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(message({author: human}));

      expect(publishedEvent().payload.author).toEqual({...human, bot: false});
    });
  });

  describe('skipped messages', () => {
    it('ignores a message without a guild, like a DM that slipped through', async () => {
      const {handle, publishIntegrationEventReceived} = await arrange();

      await expect(handle(message({guild_id: undefined}))).resolves.toBe('ignored');

      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });

    it('ignores a malformed message', async () => {
      const {handle, publishIntegrationEventReceived} = await arrange();

      await expect(handle({id: 'message-1'})).resolves.toBe('ignored');

      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });

    it.each([
      ['no installation', {installation: 'none' as const}],
      ['a removed installation', {installation: 'removed' as const}],
      ['an inactive connection', {connection: fakeConnection({lifecycleStatus: 'error'})}],
    ])('drops a message for %s as connection_unavailable', async (_name, options) => {
      const {handle, publishIntegrationEventReceived} = await arrange(options);

      await expect(handle(message())).resolves.toBe('connection_unavailable');

      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });
  });
});
