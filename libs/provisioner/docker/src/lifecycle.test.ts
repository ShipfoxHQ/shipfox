import type {
  ReconcileProvisionedRunnersBodyDto,
  ReconcileProvisionedRunnersResponseDto,
  ReportProvisionedRunnersBodyDto,
  ReportProvisionedRunnersResponseDto,
} from '@shipfox/api-runners-dto';
import type {
  ProvisionedRunnerLaunch,
  ProvisionedRunnerTracker,
  ProvisionerClient,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {ProvisionerAuthenticationError} from '@shipfox/provisioner-core';
import {type DockerContainerView, type DockerEngine, DockerEngineError} from '#docker-engine.js';
import {createDockerLifecycle} from '#lifecycle.js';
import type {DockerTemplateSpec} from '#templates.js';

const NOW = new Date('2026-01-01T00:10:00.000Z');
const RESERVATION_ID = '00000000-0000-4000-8000-000000000003';

const template: ProvisionerTemplate<DockerTemplateSpec> = {
  key: 'small',
  labels: ['ubuntu22'],
  maxConcurrency: 10,
  cost: 1,
  spec: {image: 'runner:latest', cpu: 1.5, memory: '2g'},
};

describe('createDockerLifecycle', () => {
  it('launch reports starting and creates a labeled container with resources and env', async () => {
    const engine = fakeEngine();
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.launch(launch());

    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provisioned_runner_id: 'runner-1',
      reservation_id: RESERVATION_ID,
      template_key: 'small',
      labels: ['ubuntu22'],
      state: 'starting',
      provider_kind: 'docker',
    });
    expect(engine.created[0]).toMatchObject({
      name: 'runner-1',
      image: 'runner:latest',
      env: {SHIPFOX_RUNNER_REGISTRATION_TOKEN: 'sf_ert_secret'},
      nanoCpus: 1_500_000_000,
      memoryBytes: 2 * 1024 ** 3,
    });
    expect(engine.created[0]?.labels['shipfox.provisioned_runner_id']).toBe('runner-1');
  });

  it('reports failed and rethrows when the engine fails to launch', async () => {
    const engine = fakeEngine({
      createError: new DockerEngineError('start-failed', 'cannot start'),
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.launch(launch())).rejects.toThrow(DockerEngineError);

    expect(client.reportBodies.map((body) => body.events[0]?.state)).toEqual([
      'starting',
      'failed',
    ]);
    expect(client.reportBodies[1]?.events[0]?.reason).toBe('start-failed');
  });

  it('observe re-reports running containers every tick', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'running',
      'running',
    ]);
  });

  it('reports terminal exited containers and removes them only after report succeeds', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 0})],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(client.reportBodies[0]?.events[0]?.state).toBe('stopped');
    expect(engine.removed).toEqual(['runner-1']);
  });

  it('buffers terminal reports and still removes containers when reporting transiently fails', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({reportErrors: [new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(engine.removed).toEqual(['runner-1']);

    await lifecycle.observe();

    expect(client.reportBodies[1]?.events[0]).toMatchObject({
      provisioned_runner_id: 'runner-1',
      state: 'failed',
    });
  });

  it('buffers stale-created terminal reports and still kills containers when reporting transiently fails', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          state: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });
    const client = fakeClient({reportErrors: [new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.observe();

    expect(engine.killedAndRemoved).toEqual(['runner-1']);
  });

  it('marks OOM exits as failed with an oom reason', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 137, oomKilled: true})],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({state: 'failed', reason: 'oom'});
  });

  it('reaps only created containers past the registration deadline', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          name: 'created-old',
          state: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        container({
          name: 'running-old',
          state: 'running',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.observe();

    expect(engine.killedAndRemoved).toEqual(['created-old']);
    expect(engine.removed).toEqual([]);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'running',
      'terminated',
    ]);
  });

  it('reconcile rebuilds tracker counts from listed containers', async () => {
    const engine = fakeEngine({
      containers: [
        container({name: 'starting-1', state: 'created'}),
        container({name: 'running-1', state: 'running'}),
      ],
    });
    const tracker = testTracker();
    const lifecycle = makeLifecycle({engine, tracker});

    await lifecycle.reconcile();

    expect(tracker.countsByTemplate()).toEqual(new Map([['small', {starting: 1, running: 1}]]));
  });

  it('reconcile submits deduped observed ids, including the empty set', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({client});

    await lifecycle.reconcile();

    expect(client.reconcileBodies).toEqual([{observed_provisioned_runner_ids: []}]);
  });

  it('reconcile tears down backend terminate-intent containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provisioned_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(client.reconcileBodies[0]).toEqual({observed_provisioned_runner_ids: ['runner-1']});
    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provisioned_runner_id: 'runner-1',
      state: 'terminated',
      reason: 'backend-terminate',
    });
    expect(engine.killedAndRemoved).toEqual(['runner-1']);
  });

  it('reconcile adopts backend keep-intent live containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
    });
    const tracker = testTracker();
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provisioned_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client, tracker});

    await lifecycle.reconcile();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provisioned_runner_id: 'runner-1',
      state: 'running',
    });
    expect(tracker.countsByTemplate()).toEqual(new Map([['small', {starting: 0, running: 1}]]));
  });

  it('reconcile keeps local terminal handling for backend keep-intent exited containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 0})],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provisioned_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({state: 'stopped'});
    expect(engine.removed).toEqual(['runner-1']);
  });

  it('reconcile falls back to local observe when the observed id count exceeds the API limit', async () => {
    const engine = fakeEngine({
      containers: Array.from({length: 5001}, (_, index) =>
        container({name: `runner-${index}`, state: 'running'}),
      ),
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(client.reconcileBodies).toEqual([]);
    expect(client.reportBodies.map((body) => body.events.length)).toEqual([
      1000, 1000, 1000, 1000, 1000, 1,
    ]);
  });

  it('terminate kills and reports matching managed containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'}), container({name: 'runner-2', state: 'running'})],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.terminate(['runner-1']);

    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provisioned_runner_id: 'runner-1',
      state: 'terminated',
      reason: 'backend-terminate',
    });
    expect(engine.killedAndRemoved).toEqual(['runner-1']);
  });

  it('terminate is a true no-op when no managed container matches the id', async () => {
    const engine = fakeEngine({
      containers: [container({name: 'runner-2', state: 'running'})],
    });
    const lifecycle = makeLifecycle({engine});

    await lifecycle.terminate(['runner-1']);

    expect(engine.killedAndRemoved).toEqual([]);
    expect(engine.removed).toEqual([]);
  });

  it('terminate still kills matching containers when labels are unresolvable', async () => {
    const engine = fakeEngine({
      containers: [
        container({state: 'running', labels: {'shipfox.provisioned_runner_id': 'runner-1'}}),
      ],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.terminate(['runner-1']);

    expect(client.reportBodies).toEqual([]);
    expect(engine.killedAndRemoved).toEqual(['runner-1']);
  });

  it('terminate does not list Docker for an empty id set', async () => {
    const engine = fakeEngine();
    const lifecycle = makeLifecycle({engine});

    await lifecycle.terminate([]);

    expect(engine.listManagedCalls).toBe(0);
  });

  it('terminate propagates Docker list failures', async () => {
    const lifecycle = makeLifecycle({
      engine: fakeEngine({listError: new DockerEngineError('unknown', 'daemon down')}),
    });

    await expect(lifecycle.terminate(['runner-1'])).rejects.toThrow(DockerEngineError);
  });

  it('chunks report batches at 1000 events', async () => {
    const engine = fakeEngine({
      containers: Array.from({length: 1001}, (_, index) =>
        container({name: `runner-${index}`, state: 'running'}),
      ),
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(client.reportBodies.map((body) => body.events.length)).toEqual([1000, 1]);
  });

  it('drops permanent 400 report batches instead of retrying them forever', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({reportErrors: [httpError(400)]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
    await lifecycle.flush();

    expect(engine.removed).toEqual(['runner-1']);
    expect(client.reportBodies).toHaveLength(1);
  });

  it('propagates auth failures from report delivery', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const lifecycle = makeLifecycle({
      engine,
      client: fakeClient({reportErrors: [new ProvisionerAuthenticationError(401)]}),
    });

    await expect(lifecycle.observe()).rejects.toThrow(ProvisionerAuthenticationError);
    expect(engine.removed).toEqual([]);
  });

  it('preserves terminal reports over live reports when the retry queue overflows', async () => {
    const engine = fakeEngine({
      containers: [
        ...Array.from({length: 5001}, (_, index) =>
          container({name: `runner-${index}`, state: 'running'}),
        ),
        container({name: 'terminal-runner', state: 'exited', exitCode: 0}),
      ],
    });
    const client = fakeClient({reportErrors: [new Error('api down'), new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
    await lifecycle.flush();

    expect(
      client.reportBodies
        .slice(2)
        .flatMap((body) => body.events)
        .some(
          (event) => event.provisioned_runner_id === 'terminal-runner' && event.state === 'stopped',
        ),
    ).toBe(true);
  });

  it('flush drains buffered reports', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({reportErrors: [new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
    await lifecycle.flush();

    expect(client.reportBodies[1]?.events[0]).toMatchObject({
      provisioned_runner_id: 'runner-1',
      state: 'failed',
    });
  });

  it('does not block container creation when the launch starting report is buffered', async () => {
    const engine = fakeEngine();
    const client = fakeClient({reportErrors: [new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.launch(launch());

    expect(engine.created).toHaveLength(1);

    await lifecycle.flush();

    expect(client.reportBodies[1]?.events[0]).toMatchObject({
      provisioned_runner_id: 'runner-1',
      state: 'starting',
    });
  });
});

function makeLifecycle(
  args: {
    engine?: ReturnType<typeof fakeEngine>;
    client?: ReturnType<typeof fakeClient>;
    tracker?: ProvisionedRunnerTracker;
    registrationDeadlineMs?: number;
  } = {},
) {
  return createDockerLifecycle({
    engine: args.engine ?? fakeEngine(),
    client: args.client ?? fakeClient(),
    identity: {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
    },
    tracker: args.tracker ?? testTracker(),
    templates: [template],
    now: () => NOW,
    registrationDeadlineMs: args.registrationDeadlineMs ?? 120_000,
    providerKind: 'docker',
  });
}

function launch(): ProvisionedRunnerLaunch<DockerTemplateSpec> {
  return {
    provisionedRunnerId: 'runner-1',
    reservationId: RESERVATION_ID,
    registrationToken: 'sf_ert_secret',
    registrationTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    runnerEnv: {SHIPFOX_RUNNER_REGISTRATION_TOKEN: 'sf_ert_secret'},
    template,
  };
}

function fakeClient(
  options: {
    reportErrors?: Error[];
    reconcileResponse?: ReconcileProvisionedRunnersResponseDto;
  } = {},
): ProvisionerClient & {
  reportBodies: ReportProvisionedRunnersBodyDto[];
  reconcileBodies: ReconcileProvisionedRunnersBodyDto[];
} {
  const reportBodies: ReportProvisionedRunnersBodyDto[] = [];
  const reconcileBodies: ReconcileProvisionedRunnersBodyDto[] = [];
  const reportErrors = [...(options.reportErrors ?? [])];
  return {
    reportBodies,
    reconcileBodies,
    getIdentity: () =>
      Promise.resolve({
        id: '00000000-0000-4000-8000-000000000001',
        workspace_id: '00000000-0000-4000-8000-000000000002',
      }),
    pollDemand: () =>
      Promise.resolve({stats: [], reservations: [], terminate_provisioned_runner_ids: []}),
    mintRegistrationTokens: () => Promise.resolve({tokens: []}),
    reportProvisionedRunners: (body): Promise<ReportProvisionedRunnersResponseDto> => {
      reportBodies.push(body);
      const error = reportErrors.shift();
      if (error) return Promise.reject(error);
      return Promise.resolve({accepted: body.events.length, reservations_released: 0});
    },
    reconcileProvisionedRunners: (body): Promise<ReconcileProvisionedRunnersResponseDto> => {
      reconcileBodies.push(body);
      return Promise.resolve(
        options.reconcileResponse ?? {
          runners: [],
          terminated_absent_provisioned_runner_ids: [],
        },
      );
    },
  };
}

function fakeEngine(
  options: {containers?: DockerContainerView[]; createError?: Error; listError?: Error} = {},
): DockerEngine & {
  created: Parameters<DockerEngine['createAndStart']>[0][];
  removed: string[];
  killedAndRemoved: string[];
  listManagedCalls: number;
} {
  const created: Parameters<DockerEngine['createAndStart']>[0][] = [];
  const removed: string[] = [];
  const killedAndRemoved: string[] = [];
  let listManagedCalls = 0;

  return {
    created,
    removed,
    killedAndRemoved,
    get listManagedCalls() {
      return listManagedCalls;
    },
    ensureImage: () => Promise.resolve(),
    createAndStart: (args) => {
      if (options.createError) return Promise.reject(options.createError);
      created.push(args);
      return Promise.resolve();
    },
    listManaged: () => {
      listManagedCalls += 1;
      if (options.listError) return Promise.reject(options.listError);
      return Promise.resolve(options.containers ?? []);
    },
    remove: (name) => {
      removed.push(name);
      return Promise.resolve();
    },
    killAndRemove: (name) => {
      killedAndRemoved.push(name);
      return Promise.resolve();
    },
  };
}

function testTracker(): ProvisionedRunnerTracker {
  const runners = new Map<string, {templateKey: string; state: 'starting' | 'running'}>();
  return {
    recordStarting: ({provisionedRunnerId, templateKey}) => {
      runners.set(provisionedRunnerId, {templateKey, state: 'starting'});
    },
    markRunning: (provisionedRunnerId) => {
      const runner = runners.get(provisionedRunnerId);
      if (runner) runner.state = 'running';
    },
    remove: (provisionedRunnerId) => {
      runners.delete(provisionedRunnerId);
    },
    replaceAll: (nextRunners) => {
      runners.clear();
      for (const runner of nextRunners) {
        runners.set(runner.provisionedRunnerId, {
          templateKey: runner.templateKey,
          state: runner.state,
        });
      }
    },
    countsByTemplate: () => {
      const counts = new Map<string, {starting: number; running: number}>();
      for (const runner of runners.values()) {
        const current = counts.get(runner.templateKey) ?? {starting: 0, running: 0};
        current[runner.state] += 1;
        counts.set(runner.templateKey, current);
      }
      return counts;
    },
  };
}

function container(args: {
  name?: string;
  state: DockerContainerView['state'];
  exitCode?: number;
  oomKilled?: boolean;
  createdAt?: Date;
  labels?: Readonly<Record<string, string>>;
}): DockerContainerView {
  const name = args.name ?? 'runner-1';
  return {
    id: name,
    name,
    labels: args.labels ?? {
      'shipfox.provisioned_runner_id': name,
      'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
      'shipfox.reservation_id': RESERVATION_ID,
      'shipfox.template_key': 'small',
      'shipfox.workspace_id': '00000000-0000-4000-8000-000000000002',
      'shipfox.labels': 'ubuntu22',
    },
    state: args.state,
    ...(args.exitCode !== undefined ? {exitCode: args.exitCode} : {}),
    ...(args.oomKilled !== undefined ? {oomKilled: args.oomKilled} : {}),
    createdAt: args.createdAt ?? NOW,
  };
}

function reconciledRunner(
  provisionedRunnerId: string,
  desiredIntent: 'keep' | 'terminate',
): ReconcileProvisionedRunnersResponseDto['runners'][number] {
  return {
    provisioned_runner_id: provisionedRunnerId,
    state: 'running',
    reservation_id: RESERVATION_ID,
    runner_session_id: null,
    bound_job: null,
    desired_intent: desiredIntent,
  };
}

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {response: {status}});
}
