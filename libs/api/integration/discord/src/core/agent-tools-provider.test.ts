import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordMessage,
  DiscordMessageSearchResult,
} from '#api/client.js';
import type {DiscordInstallation} from '#db/installations.js';
import {discordAgentToolCatalog, discordAgentToolSelectionCatalog} from './agent-tools.js';
import {DiscordAgentToolsProvider, type DiscordToolCallResult} from './agent-tools-provider.js';
import {DiscordIntegrationProviderError} from './errors.js';

const errorMonitoring = vi.hoisted(() => ({reportError: vi.fn()}));
vi.mock('@shipfox/node-error-monitoring', () => errorMonitoring);

const GUILD_ID = '100000000000000001';
const OTHER_GUILD_ID = '200000000000000002';
const CHANNEL_ID = '300000000000000003';
const USER_ID = '400000000000000004';

function connection(): IntegrationConnection<'discord'> {
  const now = new Date();
  return {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    provider: 'discord',
    externalAccountId: GUILD_ID,
    slug: 'discord-acme',
    displayName: 'Acme',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    repositoryAccessMode: 'selected',
  };
}

function installation(overrides: Partial<DiscordInstallation> = {}): DiscordInstallation {
  const now = new Date();
  return {
    id: 'installation-1',
    connectionId: 'connection-1',
    guildId: GUILD_ID,
    guildName: 'Acme',
    permissions: '0',
    installedByDiscordUserId: null,
    botRoleId: null,
    status: 'installed',
    generation: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const THREAD_ID = '600000000000000006';

function message(id: string, channelId = CHANNEL_ID): DiscordMessage {
  return {
    id,
    channel_id: channelId,
    content: `message ${id}`,
    author: {id: '400000000000000004', username: 'ada'},
    timestamp: '2026-09-29T12:00:00.000Z',
  };
}

function guildMember(): DiscordGuildMember {
  return {
    user: {id: USER_ID, username: 'ada', global_name: 'Ada Lovelace'},
    nick: 'Ada',
    roles: ['600000000000000006'],
    joined_at: '2026-01-02T03:04:05.000Z',
  };
}

function setup(
  options: {
    channel?: DiscordChannel | Error;
    messages?: DiscordMessage[] | Error;
    message?: DiscordMessage | Error;
    channels?: DiscordChannel[];
    threads?: DiscordChannel[];
    posted?: Error;
    search?: DiscordMessageSearchResult | Error;
    member?: DiscordGuildMember | Error;
    installation?: DiscordInstallation | undefined;
  } = {},
) {
  const channel = options.channel ?? {id: CHANNEL_ID, type: 0, guild_id: GUILD_ID};
  const messages = options.messages ?? [message('2'), message('1')];
  const search = options.search ?? {total_results: 0, messages: []};
  const member = options.member ?? guildMember();
  let postedCount = 0;
  const discord = {
    createMessage: vi.fn(({channelId, content}: {channelId: string; content: string}) => {
      if (options.posted) return Promise.reject(options.posted);
      postedCount += 1;
      return Promise.resolve({...message(`90${postedCount}`), channel_id: channelId, content});
    }),
    startThreadFromMessage: vi.fn(({messageId}: {messageId: string}) =>
      Promise.resolve({id: messageId, type: 11, guild_id: GUILD_ID}),
    ),
    getChannel: vi.fn(() =>
      channel instanceof Error ? Promise.reject(channel) : Promise.resolve(channel),
    ),
    listChannelMessages: vi.fn(() =>
      messages instanceof Error ? Promise.reject(messages) : Promise.resolve([...messages]),
    ),
    getMessage: vi.fn(() =>
      options.message instanceof Error
        ? Promise.reject(options.message)
        : Promise.resolve(options.message ?? message('1')),
    ),
    listGuildChannels: vi.fn(() => Promise.resolve(options.channels ?? [])),
    listActiveGuildThreads: vi.fn(() => Promise.resolve(options.threads ?? [])),
    searchGuildMessages: vi.fn(() =>
      search instanceof Error ? Promise.reject(search) : Promise.resolve(search),
    ),
    getGuildMember: vi.fn(() =>
      member instanceof Error ? Promise.reject(member) : Promise.resolve(member),
    ),
  };
  const provider = new DiscordAgentToolsProvider({
    discord,
    getInstallationByConnectionId: () =>
      Promise.resolve('installation' in options ? options.installation : installation()),
  });
  return {discord, provider};
}

async function callTool(
  provider: DiscordAgentToolsProvider,
  toolId: string,
  args: Record<string, unknown>,
): Promise<DiscordToolCallResult> {
  const session = await provider.openSession({
    connection: connection(),
    tools: provider.catalog(),
    scope: undefined,
  });
  return await session.call({toolId, arguments: args});
}

function failure(reason: DiscordIntegrationProviderError['reason'], status: number, extra = {}) {
  return new DiscordIntegrationProviderError({
    reason,
    message: 'Discord said no',
    status,
    ...extra,
  });
}

describe('DiscordAgentToolsProvider', () => {
  afterEach(() => {
    errorMonitoring.reportError.mockClear();
  });

  describe('catalog', () => {
    it('publishes the read tools and send_message, each selectable on its own', () => {
      const {provider} = setup();

      expect(provider.catalog()).toBe(discordAgentToolCatalog);
      expect(provider.selectionCatalog()).toBe(discordAgentToolSelectionCatalog);
      expect(discordAgentToolSelectionCatalog.selectors).toEqual([
        {token: 'read_channel', kind: 'standalone', sensitivity: 'read', sensitive: false},
        {token: 'read_thread', kind: 'standalone', sensitivity: 'read', sensitive: false},
        {token: 'list_channels', kind: 'standalone', sensitivity: 'read', sensitive: false},
        {token: 'search_messages', kind: 'standalone', sensitivity: 'read', sensitive: false},
        {token: 'read_user_profile', kind: 'standalone', sensitivity: 'read', sensitive: false},
        {token: 'send_message', kind: 'standalone', sensitivity: 'write', sensitive: false},
      ]);
    });
  });

  describe('openSession', () => {
    it.each([
      ['missing', undefined],
      ['removed', installation({status: 'removed'})],
    ])('fails with credentials-unavailable when the installation is %s', async (_name, row) => {
      const {provider} = setup({installation: row});

      await expect(
        provider.openSession({
          connection: connection(),
          tools: provider.catalog(),
          scope: undefined,
        }),
      ).rejects.toMatchObject({reason: 'credentials-unavailable'});
    });
  });

  describe('read_channel', () => {
    it('reads messages from a channel in the connection guild and links each one', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'read_channel', {
        channel_id: CHANNEL_ID,
        limit: 2,
        before: '500000000000000005',
      });

      expect(result.isError).toBeUndefined();
      expect(discord.listChannelMessages).toHaveBeenCalledWith({
        channelId: CHANNEL_ID,
        limit: 2,
        before: '500000000000000005',
        after: undefined,
      });
      expect(result.structuredContent).toMatchObject({
        messages: [
          {id: '2', url: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/2`},
          {id: '1', url: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/1`},
        ],
      });
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent);
    });
  });

  describe('read_thread', () => {
    const threadChannel = {id: THREAD_ID, type: 11, guild_id: GUILD_ID, parent_id: CHANNEL_ID};

    it('reads the starter message then the thread oldest first from a thread', async () => {
      const {provider, discord} = setup({
        channel: threadChannel,
        message: message(THREAD_ID),
        messages: [message('3', THREAD_ID), message('2', THREAD_ID)],
      });

      const result = await callTool(provider, 'read_thread', {
        channel_id: THREAD_ID,
        message_id: '700000000000000007',
        limit: 2,
      });

      expect(result.isError).toBeUndefined();
      expect(discord.getMessage).toHaveBeenCalledWith({
        channelId: CHANNEL_ID,
        messageId: THREAD_ID,
      });
      expect(discord.listChannelMessages).toHaveBeenCalledWith({channelId: THREAD_ID, limit: 2});
      expect(result.structuredContent).toMatchObject({
        messages: [
          {
            id: THREAD_ID,
            url: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${THREAD_ID}`,
          },
          {id: '2', url: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}/2`},
          {id: '3', url: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}/3`},
        ],
      });
    });

    it('reads a thread that has no starter message', async () => {
      const {provider} = setup({
        channel: threadChannel,
        message: failure('not-found', 404),
        messages: [message('3', THREAD_ID), message('2', THREAD_ID)],
      });

      const result = await callTool(provider, 'read_thread', {channel_id: THREAD_ID});

      expect(result.structuredContent).toMatchObject({messages: [{id: '2'}, {id: '3'}]});
    });

    it('reads a message that started a thread, then its thread', async () => {
      const starter = {...message(THREAD_ID), thread: {id: THREAD_ID}};
      const {provider, discord} = setup({
        message: starter,
        messages: [message('3', THREAD_ID), message('2', THREAD_ID)],
      });

      const result = await callTool(provider, 'read_thread', {
        channel_id: CHANNEL_ID,
        message_id: THREAD_ID,
      });

      expect(discord.getMessage).toHaveBeenCalledWith({
        channelId: CHANNEL_ID,
        messageId: THREAD_ID,
      });
      expect(discord.listChannelMessages).toHaveBeenCalledWith({channelId: THREAD_ID, limit: 50});
      expect(result.structuredContent).toMatchObject({
        messages: [{id: THREAD_ID}, {id: '2'}, {id: '3'}],
      });
    });

    it('reads a single message that started no thread', async () => {
      const {provider, discord} = setup({message: message('9')});

      const result = await callTool(provider, 'read_thread', {
        channel_id: CHANNEL_ID,
        message_id: '9',
      });

      expect(discord.listChannelMessages).not.toHaveBeenCalled();
      expect(result.structuredContent).toMatchObject({
        messages: [{id: '9', url: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/9`}],
      });
    });

    it('asks for message_id when the channel is not a thread', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'read_thread', {channel_id: CHANNEL_ID});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Parameter message_id is required in a channel'}],
        structuredContent: {code: 'invalid-request'},
      });
      expect(discord.getMessage).not.toHaveBeenCalled();
    });

    it('surfaces a starter failure that is not a missing message', async () => {
      const {provider} = setup({
        channel: threadChannel,
        message: failure('access-denied', 403, {discordCode: 50001}),
      });

      const result = await callTool(provider, 'read_thread', {channel_id: THREAD_ID});

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'access-denied'}});
      expect(result.content[0]?.text).toContain('View Channel and Read Message History');
    });

    it('denies a thread in another guild without reading it', async () => {
      const {provider, discord} = setup({channel: {...threadChannel, guild_id: OTHER_GUILD_ID}});

      const result = await callTool(provider, 'read_thread', {channel_id: THREAD_ID});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Not found in this server'}],
        structuredContent: {code: 'not-found'},
      });
      expect(discord.getMessage).not.toHaveBeenCalled();
      expect(discord.listChannelMessages).not.toHaveBeenCalled();
    });

    it('denies a channel in another guild without reading the message', async () => {
      const {provider, discord} = setup({
        channel: {id: CHANNEL_ID, type: 0, guild_id: OTHER_GUILD_ID},
      });

      const result = await callTool(provider, 'read_thread', {
        channel_id: CHANNEL_ID,
        message_id: '9',
      });

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
      expect(discord.getMessage).not.toHaveBeenCalled();
    });
  });

  describe('list_channels', () => {
    const channels: DiscordChannel[] = [
      {id: '1', type: 4, name: 'Support'},
      {id: '2', type: 0, name: 'support-eu', parent_id: '1', topic: 'Help for EU customers'},
      {id: '3', type: 0, name: 'random'},
    ];
    const threads: DiscordChannel[] = [{id: '4', type: 11, name: 'Support bug', parent_id: '2'}];

    it('lists the channels of the connection guild without threads by default', async () => {
      const {provider, discord} = setup({channels, threads});

      const result = await callTool(provider, 'list_channels', {});

      expect(result.isError).toBeUndefined();
      expect(discord.listGuildChannels).toHaveBeenCalledWith({guildId: GUILD_ID});
      expect(discord.listActiveGuildThreads).not.toHaveBeenCalled();
      expect(result.structuredContent).toEqual({
        channels: [
          {id: '1', name: 'Support', type: 4, parent_id: null, topic: null},
          {id: '2', name: 'support-eu', type: 0, parent_id: '1', topic: 'Help for EU customers'},
          {id: '3', name: 'random', type: 0, parent_id: null, topic: null},
        ],
      });
    });

    it('adds the active threads on request', async () => {
      const {provider, discord} = setup({channels, threads});

      const result = await callTool(provider, 'list_channels', {include_threads: true});

      expect(discord.listActiveGuildThreads).toHaveBeenCalledWith({guildId: GUILD_ID});
      expect(result.structuredContent).toMatchObject({
        channels: [{id: '1'}, {id: '2'}, {id: '3'}, {id: '4', type: 11, parent_id: '2'}],
      });
    });

    it('filters on the name ignoring case, threads included', async () => {
      const {provider} = setup({channels, threads});

      const result = await callTool(provider, 'list_channels', {
        name_contains: 'SUPPORT',
        include_threads: true,
      });

      expect(result.structuredContent).toMatchObject({
        channels: [{id: '1'}, {id: '2'}, {id: '4'}],
      });
    });

    it('never takes the guild from the arguments', async () => {
      const {provider, discord} = setup({channels});

      const result = await callTool(provider, 'list_channels', {guild_id: OTHER_GUILD_ID});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Unknown parameter: guild_id'}],
      });
      expect(discord.listGuildChannels).not.toHaveBeenCalled();
    });

    it('maps 403 to a message naming the server and the likely missing permission', async () => {
      const {provider, discord} = setup();
      discord.listGuildChannels.mockRejectedValueOnce(failure('access-denied', 403));

      const result = await callTool(provider, 'list_channels', {});

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'access-denied'}});
      expect(result.content[0]?.text).toContain('this server');
      expect(result.content[0]?.text).toContain('View Channels');
    });

    it('rejects a non-boolean include_threads before calling Discord', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'list_channels', {include_threads: 'yes'});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Parameter include_threads must be a boolean'}],
      });
      expect(discord.listGuildChannels).not.toHaveBeenCalled();
    });
  });

  describe('search_messages', () => {
    it('searches the connection guild and returns each hit with a link', async () => {
      const {provider, discord} = setup({
        search: {
          total_results: 1,
          messages: [
            [
              {...message('1'), content: 'before'},
              {...message('2'), content: 'deploy failed', hit: true},
            ],
          ],
        },
      });

      const result = await callTool(provider, 'search_messages', {
        query: 'deploy',
        channel_id: CHANNEL_ID,
        author_id: USER_ID,
        limit: 5,
        offset: 10,
      });

      expect(result.isError).toBeUndefined();
      expect(discord.searchGuildMessages).toHaveBeenCalledWith({
        guildId: GUILD_ID,
        content: 'deploy',
        channelId: CHANNEL_ID,
        authorId: USER_ID,
        limit: 5,
        offset: 10,
      });
      expect(result.structuredContent).toEqual({
        total_results: 1,
        messages: [
          {
            ...message('2'),
            content: 'deploy failed',
            hit: true,
            url: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/2`,
          },
        ],
      });
    });

    it('searches the whole guild without resolving a channel', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'search_messages', {query: 'deploy'});

      expect(result.structuredContent).toEqual({total_results: 0, messages: []});
      expect(discord.getChannel).not.toHaveBeenCalled();
    });

    it('maps an indexing answer to rate-limited with the retry delay', async () => {
      const {provider} = setup({
        search: new DiscordIntegrationProviderError({
          reason: 'rate-limited',
          message: 'Discord is indexing this server',
          status: 202,
          retryAfterSeconds: 1,
        }),
      });

      const result = await callTool(provider, 'search_messages', {query: 'deploy'});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Discord is indexing this server'}],
        structuredContent: {code: 'rate-limited', retryAfterSeconds: 1},
      });
    });

    it('denies a channel filter in another guild without searching', async () => {
      const {provider, discord} = setup({
        channel: {id: CHANNEL_ID, type: 0, guild_id: OTHER_GUILD_ID},
      });

      const result = await callTool(provider, 'search_messages', {
        query: 'deploy',
        channel_id: CHANNEL_ID,
      });

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Not found in this server'}],
        structuredContent: {code: 'not-found'},
      });
      expect(discord.searchGuildMessages).not.toHaveBeenCalled();
    });

    it('denies a direct message channel filter without searching', async () => {
      const {provider, discord} = setup({channel: {id: CHANNEL_ID, type: 1}});

      const result = await callTool(provider, 'search_messages', {
        query: 'deploy',
        channel_id: CHANNEL_ID,
      });

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'access-denied'}});
      expect(discord.searchGuildMessages).not.toHaveBeenCalled();
    });

    it('does not accept a guild from the arguments', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'search_messages', {
        query: 'deploy',
        guild_id: OTHER_GUILD_ID,
      });

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Unknown parameter: guild_id'}],
      });
      expect(discord.searchGuildMessages).not.toHaveBeenCalled();
    });

    it('names the server in a 403 when no channel is given', async () => {
      const {provider} = setup({search: failure('access-denied', 403, {discordCode: 50001})});

      const result = await callTool(provider, 'search_messages', {query: 'deploy'});

      expect(result.content[0]?.text).toContain('this server');
      expect(result.content[0]?.text).toContain('View Channel and Read Message History');
    });
  });

  describe('read_user_profile', () => {
    it('reads the member from the connection guild', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'read_user_profile', {user_id: USER_ID});

      expect(result.isError).toBeUndefined();
      expect(discord.getGuildMember).toHaveBeenCalledWith({guildId: GUILD_ID, userId: USER_ID});
      expect(result.structuredContent).toEqual({
        id: USER_ID,
        username: 'ada',
        global_name: 'Ada Lovelace',
        nickname: 'Ada',
        bot: false,
        roles: ['600000000000000006'],
        joined_at: '2026-01-02T03:04:05.000Z',
      });
    });

    it('answers null for a member without a nickname or global name', async () => {
      const {provider} = setup({
        member: {
          user: {id: USER_ID, username: 'ada'},
          roles: [],
          joined_at: '2026-01-02T03:04:05Z',
        },
      });

      const result = await callTool(provider, 'read_user_profile', {user_id: USER_ID});

      expect(result.structuredContent).toMatchObject({global_name: null, nickname: null});
    });

    it('answers a 403 without naming a permission', async () => {
      const {provider} = setup({member: failure('access-denied', 403, {discordCode: 50001})});

      const result = await callTool(provider, 'read_user_profile', {user_id: USER_ID});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Discord denied access to this server.'}],
        structuredContent: {code: 'access-denied'},
      });
    });

    it('answers a user that is not in the connection guild as not found', async () => {
      const {provider} = setup({member: failure('not-found', 404, {discordCode: 10007})});

      const result = await callTool(provider, 'read_user_profile', {user_id: USER_ID});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Not found in this server'}],
        structuredContent: {code: 'not-found'},
      });
    });

    it('does not accept a guild from the arguments', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'read_user_profile', {
        user_id: USER_ID,
        guild_id: OTHER_GUILD_ID,
      });

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Unknown parameter: guild_id'}],
      });
      expect(discord.getGuildMember).not.toHaveBeenCalled();
    });
  });

  describe('send_message', () => {
    const MESSAGE_ID = '700000000000000007';

    it('posts to the channel with the guild-scoped link and returns the first message', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'Hello',
        reply_to_message_id: MESSAGE_ID,
      });

      expect(result.isError).toBeUndefined();
      expect(discord.createMessage).toHaveBeenCalledWith({
        channelId: CHANNEL_ID,
        content: 'Hello',
        replyToMessageId: MESSAGE_ID,
      });
      const url = `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/901`;
      expect(result.structuredContent).toMatchObject({
        id: '901',
        channel_id: CHANNEL_ID,
        url,
        messages: [{id: '901', channel_id: CHANNEL_ID, url, content: 'Hello'}],
      });
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent);
    });

    it('splits a long message and replies only on the first part', async () => {
      const {provider, discord} = setup();
      const first = 'a'.repeat(1_500);
      const second = 'b'.repeat(1_500);

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: `${first}\n\n${second}`,
        reply_to_message_id: MESSAGE_ID,
      });

      expect(discord.createMessage.mock.calls.map(([call]) => call)).toEqual([
        {channelId: CHANNEL_ID, content: first, replyToMessageId: MESSAGE_ID},
        {channelId: CHANNEL_ID, content: second, replyToMessageId: undefined},
      ]);
      expect(result.structuredContent).toMatchObject({
        id: '901',
        messages: [{id: '901'}, {id: '902'}],
      });
    });

    it('fails with content-too-large over 10,000 characters without calling Discord', async () => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'a'.repeat(10_001),
      });

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'content-too-large'}});
      expect(discord.getChannel).not.toHaveBeenCalled();
      expect(discord.createMessage).not.toHaveBeenCalled();
    });

    it('fails with content-too-large when the text needs more than 5 messages', async () => {
      const {provider, discord} = setup();
      const paragraph = 'a'.repeat(1_999);

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: Array.from({length: 6}, () => paragraph).join('\n\n'),
      });

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'content-too-large'}});
      expect(discord.createMessage).not.toHaveBeenCalled();
    });

    it('posts in the existing thread of a message', async () => {
      const {provider, discord} = setup({
        message: {...message(MESSAGE_ID), thread: {id: THREAD_ID}},
      });

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'Hello',
        thread_message_id: MESSAGE_ID,
      });

      expect(discord.getMessage).toHaveBeenCalledWith({
        channelId: CHANNEL_ID,
        messageId: MESSAGE_ID,
      });
      expect(discord.startThreadFromMessage).not.toHaveBeenCalled();
      expect(discord.createMessage).toHaveBeenCalledWith({
        channelId: THREAD_ID,
        content: 'Hello',
        replyToMessageId: undefined,
      });
      expect(result.structuredContent).toMatchObject({
        channel_id: THREAD_ID,
        url: `https://discord.com/channels/${GUILD_ID}/${THREAD_ID}/901`,
      });
    });

    it('creates a public thread named after the first 80 characters of the message', async () => {
      const content = `  Weekly   sync\n\nnotes ${'word '.repeat(30)}`;
      const {provider, discord} = setup({message: {...message(MESSAGE_ID), content}});

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'Hello',
        reply_to_message_id: MESSAGE_ID,
        thread_message_id: MESSAGE_ID,
      });

      expect(discord.startThreadFromMessage).toHaveBeenCalledWith({
        channelId: CHANNEL_ID,
        messageId: MESSAGE_ID,
        name: 'Weekly sync notes word word word word word word word word word word word word wo',
      });
      expect(discord.createMessage).toHaveBeenCalledWith({
        channelId: MESSAGE_ID,
        content: 'Hello',
        replyToMessageId: undefined,
      });
      expect(result.structuredContent).toMatchObject({channel_id: MESSAGE_ID});
    });

    it('names a thread after a message without text', async () => {
      const {provider, discord} = setup({message: {...message(MESSAGE_ID), content: ''}});

      await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'Hello',
        thread_message_id: MESSAGE_ID,
      });

      expect(discord.startThreadFromMessage).toHaveBeenCalledWith(
        expect.objectContaining({name: 'Thread'}),
      );
    });

    it.each([
      10, 11, 12,
    ])('ignores thread_message_id when the channel is a thread of type %i', async (type) => {
      const {provider, discord} = setup({channel: {id: CHANNEL_ID, type, guild_id: GUILD_ID}});

      await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'Hello',
        reply_to_message_id: MESSAGE_ID,
        thread_message_id: MESSAGE_ID,
      });

      expect(discord.getMessage).not.toHaveBeenCalled();
      expect(discord.startThreadFromMessage).not.toHaveBeenCalled();
      expect(discord.createMessage).toHaveBeenCalledWith({
        channelId: CHANNEL_ID,
        content: 'Hello',
        replyToMessageId: MESSAGE_ID,
      });
    });

    it('denies a channel in another guild without posting', async () => {
      const {provider, discord} = setup({
        channel: {id: CHANNEL_ID, type: 0, guild_id: OTHER_GUILD_ID},
      });

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'Hello',
        thread_message_id: MESSAGE_ID,
      });

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Not found in this server'}],
        structuredContent: {code: 'not-found'},
      });
      expect(discord.getMessage).not.toHaveBeenCalled();
      expect(discord.startThreadFromMessage).not.toHaveBeenCalled();
      expect(discord.createMessage).not.toHaveBeenCalled();
    });

    it('denies a direct message channel without posting', async () => {
      const {provider, discord} = setup({channel: {id: CHANNEL_ID, type: 1}});

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'Hello',
      });

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'access-denied'}});
      expect(discord.createMessage).not.toHaveBeenCalled();
    });

    it('names the permissions the bot probably lacks on a 403', async () => {
      const {provider} = setup({posted: failure('access-denied', 403, {discordCode: 50013})});

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        message: 'Hello',
      });

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'access-denied'}});
      expect(result.content[0]?.text).toContain(`channel ${CHANNEL_ID}`);
      expect(result.content[0]?.text).toContain('Send Messages');
    });

    it.each([
      ['a missing message', {message: ''}, 'Missing required parameter: message'],
      ['an empty message', {message: ' \n'}, 'Parameter message must not be empty'],
      [
        'a thread_message_id with a path',
        {message: 'Hello', thread_message_id: '1/../2'},
        'Parameter thread_message_id has an invalid format',
      ],
    ])('rejects %s before calling Discord', async (name, args, expected) => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'send_message', {
        channel_id: CHANNEL_ID,
        ...(name === 'a missing message' ? {} : args),
      });

      expect(result).toMatchObject({
        isError: true,
        content: [{text: expected}],
        structuredContent: {code: 'invalid-request'},
      });
      expect(discord.createMessage).not.toHaveBeenCalled();
    });
  });

  describe('server boundary', () => {
    it('denies a channel in another guild without reading it', async () => {
      const {provider, discord} = setup({
        channel: {id: CHANNEL_ID, type: 0, guild_id: OTHER_GUILD_ID},
      });

      const result = await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Not found in this server'}],
        structuredContent: {code: 'not-found'},
      });
      expect(discord.listChannelMessages).not.toHaveBeenCalled();
    });

    it.each([
      ['a direct message', 1],
      ['a group direct message', 3],
    ])('denies %s channel without reading it', async (_name, type) => {
      const {provider, discord} = setup({channel: {id: CHANNEL_ID, type}});

      const result = await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'access-denied'}});
      expect(result.content[0]?.text).toBe('Direct message channels are not supported');
      expect(discord.listChannelMessages).not.toHaveBeenCalled();
    });

    it('resolves a channel once per process, including across sessions', async () => {
      const {provider, discord} = setup();

      await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});
      await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(discord.getChannel).toHaveBeenCalledTimes(1);
      expect(discord.listChannelMessages).toHaveBeenCalledTimes(2);
    });

    it('keeps denying a cached cross-guild channel', async () => {
      const {provider, discord} = setup({
        channel: {id: CHANNEL_ID, type: 0, guild_id: OTHER_GUILD_ID},
      });

      await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});
      const second = await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(second.isError).toBe(true);
      expect(discord.getChannel).toHaveBeenCalledTimes(1);
      expect(discord.listChannelMessages).not.toHaveBeenCalled();
    });

    it('does not cache a failed channel lookup', async () => {
      const {provider, discord} = setup({channel: failure('provider-unavailable', 502)});

      await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});
      await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(discord.getChannel).toHaveBeenCalledTimes(2);
    });
  });

  describe('error mapping', () => {
    it('maps 401 to credentials-unavailable and reports the broken token', async () => {
      const {provider} = setup({messages: failure('credentials-unavailable', 401)});

      const result = await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {code: 'credentials-unavailable'},
      });
      expect(errorMonitoring.reportError).toHaveBeenCalledWith(
        expect.any(DiscordIntegrationProviderError),
        expect.objectContaining({boundary: 'discord.agent-tools', operation: 'read_channel'}),
      );
    });

    it('maps 403 to a message naming the channel and the likely missing permission', async () => {
      const {provider} = setup({messages: failure('access-denied', 403, {discordCode: 50001})});

      const result = await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(result).toMatchObject({isError: true, structuredContent: {code: 'access-denied'}});
      expect(result.content[0]?.text).toContain(`channel ${CHANNEL_ID}`);
      expect(result.content[0]?.text).toContain('View Channel and Read Message History');
      expect(errorMonitoring.reportError).not.toHaveBeenCalled();
    });

    it('maps 404 to not found in this server', async () => {
      const {provider} = setup({channel: failure('not-found', 404)});

      const result = await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Not found in this server'}],
        structuredContent: {code: 'not-found'},
      });
    });

    it('answers a channel in another guild exactly like a missing channel', async () => {
      const missing = await callTool(
        setup({channel: failure('not-found', 404)}).provider,
        'read_channel',
        {
          channel_id: CHANNEL_ID,
        },
      );
      const otherGuild = await callTool(
        setup({channel: {id: CHANNEL_ID, type: 0, guild_id: OTHER_GUILD_ID}}).provider,
        'read_channel',
        {channel_id: CHANNEL_ID},
      );

      expect(otherGuild).toEqual(missing);
    });

    it('maps 429 to rate-limited with the retry delay', async () => {
      const {provider} = setup({
        messages: failure('rate-limited', 429, {retryAfterSeconds: 3}),
      });

      const result = await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {code: 'rate-limited', retryAfterSeconds: 3},
      });
    });

    it.each([
      ['5xx', failure('provider-unavailable', 502)],
      ['timeout', new DiscordIntegrationProviderError({reason: 'timeout', message: 'timed out'})],
    ])('maps a %s to provider-unavailable', async (_name, error) => {
      const {provider} = setup({messages: error});

      const result = await callTool(provider, 'read_channel', {channel_id: CHANNEL_ID});

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {code: 'provider-unavailable'},
      });
    });

    it('rethrows an error that is not from Discord', async () => {
      const {provider} = setup({messages: new Error('boom')});

      await expect(callTool(provider, 'read_channel', {channel_id: CHANNEL_ID})).rejects.toThrow(
        'boom',
      );
    });
  });

  describe('argument validation', () => {
    it.each([
      ['a missing channel_id', {}, 'Missing required parameter: channel_id'],
      [
        'an unknown parameter',
        {channel_id: CHANNEL_ID, guild_id: '1'},
        'Unknown parameter: guild_id',
      ],
      [
        'a channel_id with a path',
        {channel_id: '1/../2'},
        'Parameter channel_id has an invalid format',
      ],
      [
        'a limit above 100',
        {channel_id: CHANNEL_ID, limit: 101},
        'Parameter limit must be at most 100',
      ],
      ['a limit below 1', {channel_id: CHANNEL_ID, limit: 0}, 'Parameter limit must be at least 1'],
      [
        'a fractional limit',
        {channel_id: CHANNEL_ID, limit: 1.5},
        'Parameter limit must be an integer',
      ],
    ])('rejects %s before calling Discord', async (_name, args, expected) => {
      const {provider, discord} = setup();

      const result = await callTool(provider, 'read_channel', args);

      expect(result).toMatchObject({
        isError: true,
        content: [{text: expected}],
        structuredContent: {code: 'invalid-request'},
      });
      expect(discord.getChannel).not.toHaveBeenCalled();
    });

    it('rejects a tool that is not in the catalog', async () => {
      const {provider} = setup();

      const result = await callTool(provider, 'add_reaction', {});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Unknown Discord tool: add_reaction'}],
      });
    });
  });
});
