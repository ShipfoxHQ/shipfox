import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {DiscordChannel} from '#api/client.js';
import {db} from '#db/db.js';
import {upsertDiscordInstallation} from '#db/installations.js';
import {discordInstallations} from '#db/schema/installations.js';
import {BOT_ROLE_ID, fakeConnection, GUILD_ID} from '#test/index.js';
import {createDiscordChannelCache} from './channel-cache.js';
import {handleDiscordReactionAdd} from './message-reaction-add.js';

const CHANNEL_ID = 'channel-1';
const THREAD_ID = 'thread-1';
const SESSION_ID = 'session-1';

const channelsById: Record<string, DiscordChannel> = {
  [CHANNEL_ID]: {id: CHANNEL_ID, type: 0},
  [THREAD_ID]: {id: THREAD_ID, type: 11, parent_id: CHANNEL_ID},
};

const human = {id: 'user-1', username: 'ada'};

function reaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: human.id,
    channel_id: CHANNEL_ID,
    message_id: `message-${randomUUID()}`,
    guild_id: GUILD_ID,
    member: {user: human, roles: []},
    emoji: {id: null, name: '✅'},
    message_author_id: 'user-2',
    ...overrides,
  };
}

async function arrange(
  options: {
    connection?: IntegrationConnection | undefined;
    installation?: 'installed' | 'removed' | 'none';
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
      botRoleId: BOT_ROLE_ID,
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
    botUserId: 'bot-user',
  };
  const handle = (data: unknown, dispatch: {sessionId?: string | null; sequence?: number} = {}) =>
    handleDiscordReactionAdd(handlerOptions, {
      data,
      sessionId: dispatch.sessionId === undefined ? SESSION_ID : dispatch.sessionId,
      sequence: dispatch.sequence ?? 7,
    });
  const publishedEvent = () => {
    const call = publishIntegrationEventReceived.mock.calls[0]?.[0];
    if (!call) throw new Error('nothing was published');
    return call.event as {deliveryId: string; event: string; payload: Record<string, unknown>};
  };
  return {connection, handle, getChannel, publishIntegrationEventReceived, publishedEvent};
}

describe('Discord message_reaction_add ingestion', () => {
  beforeEach(async () => {
    await db().delete(discordInstallations);
  });

  describe('publishing', () => {
    it('publishes a reaction with the session id and sequence as the delivery id', async () => {
      const {connection, handle, publishedEvent} = await arrange();
      const incoming = reaction({message_id: 'message-1'});

      await expect(handle(incoming, {sessionId: 'session-9', sequence: 42})).resolves.toBe(
        'processed',
      );

      expect(publishedEvent()).toMatchObject({
        provider: 'discord',
        source: connection.slug,
        event: 'message_reaction_add',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId: 'session-9:42',
      });
      expect(publishedEvent().payload).toMatchObject({
        user_id: 'user-1',
        message_id: 'message-1',
        message_author_id: 'user-2',
        emoji: {id: null, name: '✅'},
        root_channel_id: CHANNEL_ID,
        url: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/message-1`,
      });
    });

    it('gives a replay of the same dispatch the same delivery id', async () => {
      const {handle, publishIntegrationEventReceived} = await arrange();
      const incoming = reaction();

      await handle(incoming, {sequence: 5});
      await handle(incoming, {sequence: 5});

      const [first, second] = publishIntegrationEventReceived.mock.calls.map(
        ([params]) => (params.event as {deliveryId: string}).deliveryId,
      );
      expect(first).toBe(second);
    });

    it('gives the same reaction added again on a later sequence a new delivery id', async () => {
      const {handle, publishIntegrationEventReceived} = await arrange();
      const incoming = reaction();

      await handle(incoming, {sequence: 5});
      await handle(incoming, {sequence: 9});

      const [first, second] = publishIntegrationEventReceived.mock.calls.map(
        ([params]) => (params.event as {deliveryId: string}).deliveryId,
      );
      expect(first).not.toBe(second);
    });

    it('reports a reaction the platform already has as a duplicate', async () => {
      const {handle} = await arrange({published: false});

      await expect(handle(reaction())).resolves.toBe('duplicate');
    });

    it('throws when publishing fails, so the committed mark stays below the dispatch', async () => {
      const {handle, publishIntegrationEventReceived} = await arrange();
      publishIntegrationEventReceived.mockRejectedValueOnce(new Error('database down'));

      await expect(handle(reaction())).rejects.toThrow('database down');
    });

    it('throws without a session id rather than publish under an unstable id', async () => {
      const {handle, publishIntegrationEventReceived} = await arrange();

      await expect(handle(reaction(), {sessionId: null})).rejects.toThrow('session id');

      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });
  });

  describe('placement', () => {
    it('sets the parent as root for a reaction in a thread', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(reaction({channel_id: THREAD_ID, message_id: 'm1'}));

      expect(publishedEvent().payload).toMatchObject({
        root_channel_id: CHANNEL_ID,
        url: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}/m1`,
      });
    });

    it('asks Discord once per channel, then answers from the cache', async () => {
      const {handle, getChannel} = await arrange();

      await handle(reaction());
      await handle(reaction());

      expect(getChannel).toHaveBeenCalledTimes(1);
    });

    it('publishes without a root channel when Discord cannot resolve the channel', async () => {
      const {handle, publishedEvent} = await arrange({
        getChannel: () => Promise.reject(new Error('unavailable')),
      });

      await expect(handle(reaction())).resolves.toBe('processed');

      expect(publishedEvent().payload).not.toHaveProperty('root_channel_id');
    });
  });

  describe('member.user.bot', () => {
    it('keeps an explicit bot flag', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(reaction({member: {user: {...human, bot: true}}}));

      expect(publishedEvent().payload.member).toMatchObject({user: {id: 'user-1', bot: true}});
    });

    it('turns a missing flag into false and keeps the rest of the member', async () => {
      const {handle, publishedEvent} = await arrange();

      await handle(reaction({member: {user: human, nick: 'Ada'}}));

      expect(publishedEvent().payload.member).toEqual({user: {...human, bot: false}, nick: 'Ada'});
    });
  });

  describe('skipped reactions', () => {
    it('ignores a reaction without a guild, like a DM that slipped through', async () => {
      const {handle, publishIntegrationEventReceived} = await arrange();

      await expect(handle(reaction({guild_id: undefined}))).resolves.toBe('ignored');

      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });

    it.each([
      ['a malformed reaction', {message_id: 'message-1'}],
      ['a reaction without a member', reaction({member: undefined})],
      ['a reaction without the message author', reaction({message_author_id: undefined})],
    ])('ignores %s', async (_name, incoming) => {
      const {handle, publishIntegrationEventReceived} = await arrange();

      await expect(handle(incoming)).resolves.toBe('ignored');

      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });

    it.each([
      ['no installation', {installation: 'none' as const}],
      ['a removed installation', {installation: 'removed' as const}],
      ['an inactive connection', {connection: fakeConnection({lifecycleStatus: 'error'})}],
    ])('drops a reaction for %s as connection_unavailable', async (_name, options) => {
      const {handle, publishIntegrationEventReceived} = await arrange(options);

      await expect(handle(reaction())).resolves.toBe('connection_unavailable');

      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });
  });
});
