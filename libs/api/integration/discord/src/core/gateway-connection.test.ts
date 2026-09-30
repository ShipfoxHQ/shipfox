import {reportError} from '@shipfox/node-error-monitoring';
import {createDiscordApiClient, type DiscordGatewayBot} from '#api/client.js';
import {db} from '#db/db.js';
import {getDiscordGatewaySession} from '#db/gateway-sessions.js';
import {discordGatewaySessions} from '#db/schema/gateway-sessions.js';
import {type FakeGateway, startFakeGateway} from '#test/fake-discord-gateway.js';
import {
  type DiscordGatewayRun,
  type DiscordGatewayRunOptions,
  startDiscordGatewayRun,
} from './gateway-connection.js';
import type {GatewayDispatchPayload} from './gateway-dispatch-queue.js';

vi.mock('@shipfox/node-error-monitoring', () => ({reportError: vi.fn()}));

const SHARD_ID = 0;
const TEST_TIMEOUT_MS = 20_000;

function messageCreate(id: string) {
  return {id, content: `message ${id}`};
}

describe('Discord Gateway connection', () => {
  let gateway: FakeGateway;
  const runs: DiscordGatewayRun[] = [];

  beforeEach(async () => {
    await db().delete(discordGatewaySessions);
    gateway = await startFakeGateway();
    vi.mocked(reportError).mockClear();
  });

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.stop()));
    await gateway.close();
  });

  function connect(options: DiscordGatewayRunOptions = {}): DiscordGatewayRun {
    const client = createDiscordApiClient({botToken: 'test-token', baseUrl: gateway.apiBaseUrl});
    const run = startDiscordGatewayRun({
      botToken: 'test-token',
      apiBaseUrl: gateway.apiBaseUrl,
      getGatewayBot: () => client.getGatewayBot(),
      identifySpacingMs: 5,
      flushIntervalMs: 20,
      backoffMs: () => 10,
      ...options,
    });
    runs.push(run);
    return run;
  }

  async function stop(run: DiscordGatewayRun): Promise<void> {
    runs.splice(runs.indexOf(run), 1);
    await run.stop();
  }

  async function storedSession() {
    return await getDiscordGatewaySession({shardId: SHARD_ID});
  }

  async function waitForStored(
    predicate: (row: NonNullable<Awaited<ReturnType<typeof storedSession>>>) => boolean,
  ) {
    await vi.waitFor(
      async () => {
        const row = await storedSession();
        expect(row && predicate(row)).toBe(true);
      },
      {timeout: 10_000, interval: 20},
    );
  }

  it(
    'identifies, skips every dispatch, and advances the committed cursor',
    async () => {
      connect();
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});

      const message = gateway.dispatch('MESSAGE_CREATE', messageCreate('m1'));

      await waitForStored((row) => row.committedSequence === message);
      await expect(storedSession()).resolves.toMatchObject({
        sessionId: gateway.sessionId,
        resumeGatewayUrl: expect.stringContaining('ws://127.0.0.1'),
        receivedSequence: message,
        committedSequence: message,
      });
      expect(gateway.identifies).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'does not commit past a dispatch whose publication is blocked',
    async () => {
      const handled: string[] = [];
      connect({
        handlers: {
          MESSAGE_CREATE: (payload) => {
            handled.push((payload.d as {id: string}).id);
            return new Promise<void>(() => undefined);
          },
        },
      });
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});
      await waitForStored((row) => row.committedSequence === 1);

      const blocked = gateway.dispatch('MESSAGE_CREATE', messageCreate('blocked'));
      const queued = gateway.dispatch('MESSAGE_CREATE', messageCreate('queued'));

      await waitForStored((row) => row.receivedSequence === queued);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const row = await storedSession();
      expect(row?.committedSequence).toBe(blocked - 1);
      expect(handled).toEqual(['blocked']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'replays a dispatch that was received but never committed when a new leader takes over',
    async () => {
      const first = connect({
        handlers: {MESSAGE_CREATE: () => new Promise<void>(() => undefined)},
      });
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});
      await waitForStored((row) => row.committedSequence === 1);
      const blocked = gateway.dispatch('MESSAGE_CREATE', messageCreate('blocked'));
      const queued = gateway.dispatch('MESSAGE_CREATE', messageCreate('queued'));
      await waitForStored((row) => row.receivedSequence === queued);
      await stop(first);

      const replayed: string[] = [];
      connect({
        handlers: {
          MESSAGE_CREATE: (payload) => {
            replayed.push((payload.d as {id: string}).id);
          },
        },
      });

      await vi.waitFor(() => expect(replayed).toEqual(['blocked', 'queued']), {timeout: 10_000});
      expect(gateway.resumes).toEqual([{sessionId: gateway.sessionId, seq: blocked - 1}]);
      await waitForStored((row) => (row.committedSequence ?? 0) >= queued);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'resumes on takeover without spending an Identify and keeps the session on our own destroy',
    async () => {
      const first = connect();
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});
      const message = gateway.dispatch('MESSAGE_CREATE', messageCreate('m1'));
      await waitForStored((row) => row.committedSequence === message);
      const sessionId = gateway.sessionId;

      await stop(first);

      await vi.waitFor(() => expect(gateway.clientCloseCodes).toContain(4000));
      await expect(storedSession()).resolves.toMatchObject({
        sessionId,
        committedSequence: message,
      });

      connect();

      await vi.waitFor(() => expect(gateway.resumes).toHaveLength(1), {timeout: 10_000});
      expect(gateway.resumes[0]).toEqual({sessionId, seq: message});
      expect(gateway.identifies).toBe(1);
      await waitForStored((row) => (row.committedSequence ?? 0) > message);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'keeps the mark contiguous when the library emits READY after GUILD_CREATE',
    async () => {
      await gateway.close();
      gateway = await startFakeGateway({guildCreateAfterReady: true});
      const seen: string[] = [];
      connect({
        handlers: {
          READY: () => {
            seen.push('READY');
          },
          GUILD_CREATE: () => {
            seen.push('GUILD_CREATE');
          },
        },
      });

      await waitForStored((row) => row.committedSequence === 2);

      expect(seen.sort()).toEqual(['GUILD_CREATE', 'READY']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'destroys the manager on a handler failure and resumes from the mark so Discord replays it',
    async () => {
      const attempts: string[] = [];
      let failNext = true;
      connect({
        handlers: {
          MESSAGE_CREATE: (payload: GatewayDispatchPayload) => {
            attempts.push((payload.d as {id: string}).id);
            if (failNext) {
              failNext = false;
              throw new Error('publish failed');
            }
          },
        },
      });
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});
      await waitForStored((row) => row.committedSequence === 1);
      const sessionId = gateway.sessionId;

      const failed = gateway.dispatch('MESSAGE_CREATE', messageCreate('failing'));
      const behind = gateway.dispatch('MESSAGE_CREATE', messageCreate('behind'));

      await vi.waitFor(() => expect(attempts).toEqual(['failing', 'failing', 'behind']), {
        timeout: 10_000,
      });
      expect(gateway.clientCloseCodes).toContain(4000);
      expect(gateway.resumes[0]).toEqual({sessionId, seq: failed - 1});
      expect(gateway.identifies).toBe(1);
      expect(reportError).toHaveBeenCalled();
      await waitForStored((row) => (row.committedSequence ?? 0) >= behind);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'clears the session on a library Invalid Session and identifies again through the guard',
    async () => {
      const remaining = {value: 1000};
      const guardChecks = vi.fn();
      const client = createDiscordApiClient({botToken: 'test-token', baseUrl: gateway.apiBaseUrl});
      connect({
        getGatewayBot: async () => {
          guardChecks();
          const bot: DiscordGatewayBot = await client.getGatewayBot();
          return {
            ...bot,
            session_start_limit: {...bot.session_start_limit, remaining: remaining.value},
          };
        },
      });
      await vi.waitFor(() => expect(gateway.sessionId).toBeDefined(), {timeout: 10_000});
      await waitForStored((row) => row.committedSequence === 1);
      const firstSessionId = gateway.sessionId;
      expect(guardChecks).toHaveBeenCalledTimes(1);

      gateway.rejectNextResume();
      gateway.dropSocket();

      await vi.waitFor(() => expect(gateway.identifies).toBe(2), {timeout: 15_000});
      expect(guardChecks).toHaveBeenCalledTimes(2);
      expect(gateway.sessionId).not.toBe(firstSessionId);
      await waitForStored(
        (row) => row.sessionId === gateway.sessionId && row.committedSequence === 1,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends no Identify while the guard refuses, and identifies once the budget recovers',
    async () => {
      const bot = (remaining: number): DiscordGatewayBot => ({
        url: 'unused',
        shards: 1,
        session_start_limit: {total: 1000, remaining, reset_after: 30, max_concurrency: 1},
      });
      const getGatewayBot = vi.fn().mockResolvedValue(bot(99));
      connect({getGatewayBot});

      await vi.waitFor(() => expect(getGatewayBot.mock.calls.length).toBeGreaterThan(2), {
        timeout: 10_000,
      });
      expect(gateway.identifies).toBe(0);
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
        boundary: 'integrations.discord.gateway',
      });

      getGatewayBot.mockResolvedValue(bot(500));

      await vi.waitFor(() => expect(gateway.identifies).toBe(1), {timeout: 10_000});
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'backs off and retries when the connection cannot start',
    async () => {
      const backoffs: number[] = [];
      await gateway.close();
      const unreachable = 'http://127.0.0.1:1/api/v10';
      connect({
        apiBaseUrl: unreachable,
        getGatewayBot: () => Promise.reject(new Error('unreachable')),
        backoffMs: (attempt) => {
          backoffs.push(attempt);
          return 10;
        },
      });

      await vi.waitFor(() => expect(backoffs.length).toBeGreaterThanOrEqual(3), {timeout: 15_000});

      expect(backoffs.slice(0, 3)).toEqual([0, 1, 2]);
      gateway = await startFakeGateway();
    },
    TEST_TIMEOUT_MS,
  );
});
