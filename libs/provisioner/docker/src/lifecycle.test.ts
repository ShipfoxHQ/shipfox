import type {
  ReportProvisionedRunnersBodyDto,
  ReportProvisionedRunnersResponseDto,
} from '@shipfox/api-runners-dto';
import type {
  ProvisionedRunnerLaunch,
  ProvisionedRunnerTracker,
  ProvisionerClient,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
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
      env: {SHIPFOX_RUNNER_TOKEN: 'sfrt_secret'},
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

  it('does not remove terminal containers when reporting fails', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({reportError: new Error('api down')});
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.observe()).rejects.toThrow('api down');

    expect(engine.removed).toEqual([]);
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
    registrationToken: 'sfrt_secret',
    registrationTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    runnerEnv: {SHIPFOX_RUNNER_TOKEN: 'sfrt_secret'},
    template,
  };
}

function fakeClient(options: {reportError?: Error} = {}): ProvisionerClient & {
  reportBodies: ReportProvisionedRunnersBodyDto[];
} {
  const reportBodies: ReportProvisionedRunnersBodyDto[] = [];
  return {
    reportBodies,
    getIdentity: () =>
      Promise.resolve({
        id: '00000000-0000-4000-8000-000000000001',
        workspace_id: '00000000-0000-4000-8000-000000000002',
      }),
    pollDemand: () => Promise.resolve({stats: [], reservations: []}),
    mintRegistrationTokens: () => Promise.resolve({tokens: []}),
    reportProvisionedRunners: (body): Promise<ReportProvisionedRunnersResponseDto> => {
      reportBodies.push(body);
      if (options.reportError) return Promise.reject(options.reportError);
      return Promise.resolve({accepted: body.events.length, reservations_released: 0});
    },
  };
}

function fakeEngine(
  options: {containers?: DockerContainerView[]; createError?: Error} = {},
): DockerEngine & {
  created: Parameters<DockerEngine['createAndStart']>[0][];
  removed: string[];
  killedAndRemoved: string[];
} {
  const created: Parameters<DockerEngine['createAndStart']>[0][] = [];
  const removed: string[] = [];
  const killedAndRemoved: string[] = [];

  return {
    created,
    removed,
    killedAndRemoved,
    ensureImage: () => Promise.resolve(),
    createAndStart: (args) => {
      if (options.createError) return Promise.reject(options.createError);
      created.push(args);
      return Promise.resolve();
    },
    listManaged: () => Promise.resolve(options.containers ?? []),
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
}): DockerContainerView {
  const name = args.name ?? 'runner-1';
  return {
    id: name,
    name,
    labels: {
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
