import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {reportError} from '@shipfox/node-error-monitoring';
import {createDiscordApiClient, type DiscordChannel} from '#api/client.js';
import {db} from '#db/db.js';
import {getDiscordGatewaySession} from '#db/gateway-sessions.js';
import {upsertDiscordInstallation} from '#db/installations.js';
import {discordGatewaySessions} from '#db/schema/gateway-sessions.js';
import {discordInstallations} from '#db/schema/installations.js';
import {type FakeGateway, startFakeGateway} from '#test/fake-discord-gateway.js';
import {BOT_ROLE_ID, fakeConnection, GUILD_ID} from '#test/index.js';
import {type DiscordGatewayRun, startDiscordGatewayRun} from './gateway-connection.js';
import {createDiscordGatewayHandlers} from './gateway-handlers.js';

vi.mock('@shipfox/node-error-monitoring', () => ({reportError: vi.fn()}));

const SHARD_ID = 0;
const TEST_TIMEOUT_MS = 20_000;
const CHANNEL_ID = 'channel-1';
const THREAD_ID = 'thread-1';

describe('Discord Gateway message handlers', () => {
  let gateway: FakeGateway;
  let connection: IntegrationConnection;
  const runs: DiscordGatewayRun[] = [];

  beforeEach(async () => {
    await db().delete(discordGatewaySessions);
    await db().delete(discordInstallations);
    gateway = await startFakeGateway();
    connection = fakeConnection();
    await upsertDiscordInstallation({
      connectionId: connection.id,
      guildId: GUILD_ID,
      guildName: 'Acme',
      permissions: '0',
      botRoleId: BOT_ROLE_ID,
      status: 'installed',
    });
    vi.mocked(reportError).mockClear();
  });

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.stop()));
    await gateway.close();
  });

  function arrangeHandlers() {
    const getChannel = vi.fn(
      ({channelId}: {channelId: string}): Promise<DiscordChannel> =>
        Promise.resolve({
          id: channelId,
          type: channelId === THREAD_ID ? 11 : 0,
          ...(channelId === THREAD_ID ? {parent_id: CHANNEL_ID} : {}),
        }),
    );
    const published: {deliveryId: string; payload: Record<string, unknown>}[] = [];
    const handlers = createDiscordGatewayHandlers({
      coreDb: db,
      publishIntegrationEventReceived: ({event}) => {
        published.push(event as (typeof published)[number]);
        return Promise.resolve({published: true});
      },
      getIntegrationConnectionById: () => Promise.resolve(connection),
      discord: {getChannel},
      botUserId: 'bot-user',
    });
    return {handlers, getChannel, published};
  }

  function connect(handlers: ReturnType<typeof arrangeHandlers>['handlers']): DiscordGatewayRun {
    const client = createDiscordApiClient({botToken: 'test-token', baseUrl: gateway.apiBaseUrl});
    const run = startDiscordGatewayRun({
      botToken: 'test-token',
      apiBaseUrl: gateway.apiBaseUrl,
      getGatewayBot: () => client.getGatewayBot(),
      identifySpacingMs: 5,
      flushIntervalMs: 20,
      backoffMs: () => 10,
      handlers,
    });
    runs.push(run);
    return run;
  }

  async function waitForCommitted(sequence: number) {
    await vi.waitFor(
      async () => {
        const row = await getDiscordGatewaySession({shardId: SHARD_ID});
        expect(row?.committedSequence ?? 0).toBeGreaterThanOrEqual(sequence);
      },
      {timeout: 10_000, interval: 20},
    );
  }

  it(
    'resolves placement from the channels and threads in GUILD_CREATE without asking Discord',
    async () => {
      const {handlers, getChannel, published} = arrangeHandlers();
      connect(handlers);
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});
      gateway.dispatch('GUILD_CREATE', {
        id: GUILD_ID,
        channels: [{id: CHANNEL_ID, type: 0}],
        threads: [{id: THREAD_ID, type: 11, parent_id: CHANNEL_ID}],
      });

      const last = gateway.dispatch('MESSAGE_CREATE', {
        id: 'm1',
        channel_id: THREAD_ID,
        guild_id: GUILD_ID,
        author: {id: 'user-1'},
        mentions: [{id: 'bot-user'}],
        mention_roles: [],
      });

      await waitForCommitted(last);
      expect(getChannel).not.toHaveBeenCalled();
      expect(published).toHaveLength(1);
      expect(published[0]?.payload).toMatchObject({
        thread_id: THREAD_ID,
        root_channel_id: CHANNEL_ID,
        mentions_bot: true,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sees a role mention right after a takeover, when no GUILD_CREATE refilled the caches',
    async () => {
      const first = arrangeHandlers();
      const firstRun = connect(first.handlers);
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});
      const warmup = gateway.dispatch('GUILD_CREATE', {id: GUILD_ID, channels: [], threads: []});
      await waitForCommitted(warmup);
      runs.splice(runs.indexOf(firstRun), 1);
      await firstRun.stop();

      const second = arrangeHandlers();
      connect(second.handlers);
      await vi.waitFor(() => expect(gateway.resumes).toHaveLength(1), {timeout: 10_000});
      const message = gateway.dispatch('MESSAGE_CREATE', {
        id: 'm-role',
        channel_id: THREAD_ID,
        guild_id: GUILD_ID,
        author: {id: 'user-1'},
        mentions: [],
        mention_roles: [BOT_ROLE_ID],
      });

      await waitForCommitted(message);
      expect(gateway.identifies).toBe(1);
      expect(second.getChannel).toHaveBeenCalledTimes(1);
      expect(second.published).toHaveLength(1);
      expect(second.published[0]?.payload).toMatchObject({
        mentions_bot: true,
        thread_id: THREAD_ID,
        root_channel_id: CHANNEL_ID,
      });
      expect(first.published).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'forgets a deleted thread and asks Discord again on its next message',
    async () => {
      const {handlers, getChannel} = arrangeHandlers();
      connect(handlers);
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});
      gateway.dispatch('THREAD_CREATE', {id: THREAD_ID, type: 11, parent_id: CHANNEL_ID});
      gateway.dispatch('THREAD_DELETE', {id: THREAD_ID, type: 11, parent_id: CHANNEL_ID});

      const last = gateway.dispatch('MESSAGE_CREATE', {
        id: 'm1',
        channel_id: THREAD_ID,
        guild_id: GUILD_ID,
        author: {id: 'user-1'},
      });

      await waitForCommitted(last);
      expect(getChannel).toHaveBeenCalledTimes(1);
    },
    TEST_TIMEOUT_MS,
  );
});
