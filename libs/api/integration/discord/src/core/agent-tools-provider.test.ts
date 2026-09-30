import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {DiscordChannel, DiscordMessage} from '#api/client.js';
import type {DiscordInstallation} from '#db/installations.js';
import {discordAgentToolCatalog, discordAgentToolSelectionCatalog} from './agent-tools.js';
import {DiscordAgentToolsProvider, type DiscordToolCallResult} from './agent-tools-provider.js';
import {DiscordIntegrationProviderError} from './errors.js';

const errorMonitoring = vi.hoisted(() => ({reportError: vi.fn()}));
vi.mock('@shipfox/node-error-monitoring', () => errorMonitoring);

const GUILD_ID = '100000000000000001';
const OTHER_GUILD_ID = '200000000000000002';
const CHANNEL_ID = '300000000000000003';

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

function message(id: string): DiscordMessage {
  return {
    id,
    channel_id: CHANNEL_ID,
    content: `message ${id}`,
    author: {id: '400000000000000004', username: 'ada'},
    timestamp: '2026-09-29T12:00:00.000Z',
  };
}

function setup(
  options: {
    channel?: DiscordChannel | Error;
    messages?: DiscordMessage[] | Error;
    installation?: DiscordInstallation | undefined;
  } = {},
) {
  const channel = options.channel ?? {id: CHANNEL_ID, type: 0, guild_id: GUILD_ID};
  const messages = options.messages ?? [message('2'), message('1')];
  const discord = {
    getChannel: vi.fn(() =>
      channel instanceof Error ? Promise.reject(channel) : Promise.resolve(channel),
    ),
    listChannelMessages: vi.fn(() =>
      messages instanceof Error ? Promise.reject(messages) : Promise.resolve(messages),
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
    it('publishes read_channel as a read tool selectable on its own', () => {
      const {provider} = setup();

      expect(provider.catalog()).toBe(discordAgentToolCatalog);
      expect(provider.selectionCatalog()).toBe(discordAgentToolSelectionCatalog);
      expect(discordAgentToolSelectionCatalog.selectors).toEqual([
        {token: 'read_channel', kind: 'standalone', sensitivity: 'read', sensitive: false},
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

      const result = await callTool(provider, 'send_message', {});

      expect(result).toMatchObject({
        isError: true,
        content: [{text: 'Unknown Discord tool: send_message'}],
      });
    });
  });
});
