import type {ModuleRuntimeContext, ModuleServiceHandle} from '@shipfox/node-module';
import {
  closePostgresClient,
  createPostgresClient,
  openPostgresSession,
  type Client as PostgresClient,
  pgClient,
} from '@shipfox/node-postgres';
import {
  createDiscordGatewayService,
  type DiscordGatewayServiceOptions,
  GATEWAY_LOCK_KEY,
  type GatewayLostReason,
} from './gateway-service.js';

const FAST = {acquireRetryMs: 20, livenessIntervalMs: 20};

async function waitFor(condition: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(condition()).toBe(true), {timeout: 5_000, interval: 10});
}

describe('Discord Gateway leader election', () => {
  const handles: ModuleServiceHandle[] = [];
  const sessions: PostgresClient[] = [];

  beforeAll(() => {
    createPostgresClient();
  });

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.stop()));
    await Promise.all(sessions.splice(0).map((session) => session.end().catch(() => undefined)));
  });

  afterAll(async () => {
    await closePostgresClient();
  });

  function startReplica(options: DiscordGatewayServiceOptions = {}) {
    const events: string[] = [];
    const lostReasons: GatewayLostReason[] = [];
    const replicaSessions: PostgresClient[] = [];
    const service = createDiscordGatewayService({
      ...FAST,
      ...(options.livenessIntervalMs === undefined
        ? {}
        : {livenessIntervalMs: options.livenessIntervalMs}),
      openSession: async () => {
        const session = await openPostgresSession();
        replicaSessions.push(session);
        sessions.push(session);
        return session;
      },
      onLeading: () => {
        events.push('leading');
      },
      onLost: async (reason) => {
        events.push(`lost:${reason}`);
        lostReasons.push(reason);
        await options.onLost?.(reason);
      },
    });
    const started = service.start({} as ModuleRuntimeContext).then((handle) => {
      handles.push(handle);
      return handle;
    });
    return {events, lostReasons, replicaSessions, started};
  }

  it('elects one leader among two replicas', async () => {
    const first = startReplica();
    await waitFor(() => first.events.includes('leading'));
    const second = startReplica();

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(first.events).toEqual(['leading']);
    expect(second.events).toEqual([]);
  });

  it('hands leadership to the standby when the leader shuts down', async () => {
    const first = startReplica();
    await waitFor(() => first.events.includes('leading'));
    const second = startReplica();
    const firstHandle = await first.started;

    await firstHandle.stop();

    await waitFor(() => second.events.includes('leading'));
    expect(first.events).toEqual(['leading', 'lost:shutdown']);
  });

  it('runs onLost before releasing the lock on shutdown', async () => {
    let lockHeldDuringOnLost: boolean | undefined;
    const replica = startReplica({
      onLost: async () => {
        const probe = await pgClient().query<{acquired: boolean}>(
          'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
          [GATEWAY_LOCK_KEY],
        );
        lockHeldDuringOnLost = probe.rows[0]?.acquired === false;
      },
    });
    await waitFor(() => replica.events.includes('leading'));

    await (await replica.started).stop();

    expect(lockHeldDuringOnLost).toBe(true);
  });

  it('reports onLost and lets the standby lead when the lock connection is dropped', async () => {
    const first = startReplica();
    await waitFor(() => first.events.includes('leading'));
    const second = startReplica();
    const pid = await first.replicaSessions[0]?.query<{pid: number}>(
      'SELECT pg_backend_pid() AS pid',
    );
    const lockPid = pid?.rows[0]?.pid;

    await pgClient().query('SELECT pg_terminate_backend($1)', [lockPid]);

    await waitFor(() => first.lostReasons.includes('lost'));
    // The old leader reconnects at once and may win the lock again, so release it for a deterministic takeover.
    await (await first.started).stop();
    await waitFor(() => second.events.includes('leading'));
  });

  it('gives up the lease when the liveness probe never answers', async () => {
    const replica = startReplica({livenessIntervalMs: 50});
    await waitFor(() => replica.events.includes('leading'));
    const session = replica.replicaSessions[0];
    if (!session) throw new Error('No lock session');
    vi.spyOn(session, 'query').mockImplementation(() => new Promise(() => undefined) as never);

    await waitFor(() => replica.lostReasons.includes('lost'));
  });

  it('keeps retrying when the database connection cannot be opened', async () => {
    let attempts = 0;
    const service = createDiscordGatewayService({
      ...FAST,
      openSession: () => {
        attempts += 1;
        return Promise.reject(new Error('connection refused'));
      },
    });
    const handle = await service.start({} as ModuleRuntimeContext);
    handles.push(handle);

    await waitFor(() => attempts >= 3);
  });
});
