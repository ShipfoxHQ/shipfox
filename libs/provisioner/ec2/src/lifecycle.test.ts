import type {ReportRunnerInstancesBodyDto} from '@shipfox/api-runners-dto';
import type {
  ProviderRunnerLaunch,
  ProviderRunnerTracker,
  ProvisionerClient,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {ProvisionerAuthenticationError} from '@shipfox/provisioner-core';
import {type Ec2Engine, Ec2EngineError, type Ec2InstanceView} from '#ec2-engine.js';
import {createEc2Lifecycle} from '#lifecycle.js';
import type {Ec2TemplateSpec} from '#templates.js';

const observability = vi.hoisted(() => ({
  logger: {error: vi.fn(), info: vi.fn()},
  recordEc2Launch: vi.fn(),
  recordEc2Termination: vi.fn(),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => observability.logger}));
vi.mock('#metrics/instance.js', () => ({
  recordEc2Launch: observability.recordEc2Launch,
  recordEc2Termination: observability.recordEc2Termination,
}));

const NOW = new Date('2026-01-01T00:10:00.000Z');
const RUNNER_INSTANCE_ID = '00000000-0000-4000-8000-000000000004';

const template: ProvisionerTemplate<Ec2TemplateSpec> = {
  key: 'spot-small',
  labels: ['ubuntu22'],
  maxConcurrency: 10,
  cost: 1,
  spec: {
    ami: 'ami-0123456789abcdef0',
    instanceType: 'm6i.large',
    market: 'spot',
    spotMaxPrice: null,
    subnets: ['subnet-a', 'subnet-b'],
    securityGroups: ['sg-runner'],
    associatePublicIp: false,
    rootVolumeGb: 100,
    rootDeviceName: '/dev/sda1',
  },
};

describe('createEc2Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches and reports starting before launching an instance', async () => {
    const engine = fakeEngine();
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.launch(launch());

    expect(client.attachments).toEqual([
      {runnerInstanceId: RUNNER_INSTANCE_ID, providerRunnerId: 'runner-1'},
    ]);
    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      runner_instance_id: RUNNER_INSTANCE_ID,
      provider_runner_id: 'runner-1',
      state: 'starting',
      provider_kind: 'ec2',
    });
    expect(engine.runArgs[0]).toMatchObject({
      clientToken: 'runner-1',
      ami: 'ami-0123456789abcdef0',
      market: 'spot',
      tags: {'shipfox.provider_runner_id': 'runner-1'},
    });
    expect(observability.recordEc2Launch).toHaveBeenCalledWith('spot', 'launched');
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provisioned_runner_id: 'runner-1',
        aws_instance_id: 'i-123',
      }),
      'Launched EC2 runner instance',
    );
  });

  it('reports a classified failure and rethrows when EC2 launch fails', async () => {
    const error = new Ec2EngineError('insufficient-capacity', 'no capacity');
    const lifecycle = makeLifecycle({engine: fakeEngine({runError: error})});

    await expect(lifecycle.launch(launch())).rejects.toThrow(error);

    expect(lifecycle).toBeDefined();
  });

  it('reports the classified failure when EC2 launch fails', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({runError: new Ec2EngineError('throttled', 'slow down')}),
      client,
    });

    await expect(lifecycle.launch(launch())).rejects.toThrow(Ec2EngineError);

    expect(client.reportBodies.flatMap((body) => body.events)).toMatchObject([
      {state: 'starting'},
      {state: 'failed', reason: 'throttled'},
    ]);
    expect(observability.recordEc2Launch).toHaveBeenCalledWith('spot', 'throttled');
  });

  it('preserves a just-launched instance in the tracker while DescribeInstances lags', async () => {
    const tracker = testTracker();
    const lifecycle = makeLifecycle({engine: fakeEngine(), tracker});

    await lifecycle.launch(launch());
    await lifecycle.observe();

    expect(tracker.countsByTemplate()).toEqual(
      new Map([['spot-small', {starting: 1, running: 0}]]),
    );
  });

  it('rebuilds the tracker and reports observed running instances', async () => {
    const tracker = testTracker();
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
      tracker,
    });

    await lifecycle.observe();

    expect(tracker.countsByTemplate()).toEqual(
      new Map([['spot-small', {starting: 0, running: 1}]]),
    );
    expect(client.reportBodies[0]?.events[0]).toMatchObject({state: 'running'});
  });

  it('reports a Spot-reclaimed terminated instance as failed', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({
        instances: [
          instance({
            state: 'terminated',
            stateTransitionReason: 'Server.SpotInstanceTermination: capacity reclaimed',
          }),
        ],
      }),
      client,
    });

    await lifecycle.observe();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      state: 'failed',
      reason: 'spot-interruption',
    });
    expect(observability.recordEc2Termination).toHaveBeenCalledWith('spot-interruption');
  });

  it('propagates observation failures so the core loop degrades capacity to zero', async () => {
    const error = new Ec2EngineError('unreachable', 'EC2 unavailable');
    const lifecycle = makeLifecycle({engine: fakeEngine({listError: error})});

    await expect(lifecycle.observe()).rejects.toThrow(error);
  });

  it('retries transiently failed reports on the next observation', async () => {
    const client = fakeClient({reportErrors: [new Error('API unavailable')]});
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.reportBodies).toHaveLength(3);
    expect(client.reportBodies[1]?.events[0]).toMatchObject({state: 'running'});
  });

  it('does not retry permanently invalid report batches', async () => {
    const client = fakeClient({reportErrors: [httpError(400)]});
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
    });

    await lifecycle.observe();
    await lifecycle.flush();

    expect(client.reportBodies).toHaveLength(1);
  });

  it('keeps authentication report failures fatal', async () => {
    const lifecycle = makeLifecycle({
      client: fakeClient({reportErrors: [new ProvisionerAuthenticationError(401)]}),
    });

    await expect(lifecycle.launch(launch())).rejects.toThrow(ProvisionerAuthenticationError);
  });

  it('reports a failed launch and never calls runInstance when provider identity attach is rejected', async () => {
    const engine = fakeEngine();
    const client = fakeClient({attachResult: {attached: false}});
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.launch(launch())).rejects.toThrow(
      `Provider identity was not attached for runner instance ${RUNNER_INSTANCE_ID}`,
    );

    expect(engine.runArgs).toHaveLength(0);
    expect(client.reportBodies.flatMap((body) => body.events)).toMatchObject([{state: 'failed'}]);
  });

  it('rejects and reports a failure when the template has no subnets', async () => {
    const emptySubnetsTemplate: ProvisionerTemplate<Ec2TemplateSpec> = {
      ...template,
      spec: {...template.spec, subnets: []},
    };
    const engine = fakeEngine();
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.launch({...launch(), template: emptySubnetsTemplate})).rejects.toThrow(
      'Template spot-small has no subnets.',
    );

    expect(engine.runArgs).toHaveLength(0);
    expect(client.reportBodies.flatMap((body) => body.events)).toMatchObject([
      {state: 'starting'},
      {state: 'failed'},
    ]);
  });

  it('chunks report batches at 1000 events', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({
        instances: Array.from({length: 1500}, () => instance({state: 'running'})),
      }),
      client,
    });

    await lifecycle.observe();

    expect(client.reportBodies).toHaveLength(2);
    expect(client.reportBodies[0]?.events).toHaveLength(1000);
    expect(client.reportBodies[1]?.events).toHaveLength(500);
  });

  it('skips reporting and tracking an instance whose labels cannot be resolved', async () => {
    const client = fakeClient();
    const tracker = testTracker();
    const unlabeledInstance: Ec2InstanceView = {
      instanceId: 'i-999',
      state: 'running',
      tags: {
        'shipfox.provider_runner_id': 'runner-unlabeled',
        'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
      },
    };
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [unlabeledInstance]}),
      client,
      tracker,
    });

    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events)).toHaveLength(0);
    expect(tracker.countsByTemplate().size).toBe(0);
  });

  it('reports an instance with resolved labels but keeps it out of the tracker when the template key is unknown', async () => {
    const client = fakeClient();
    const tracker = testTracker();
    const instanceWithoutTemplateKey: Ec2InstanceView = {
      instanceId: 'i-888',
      state: 'running',
      tags: {
        'shipfox.provider_runner_id': 'runner-no-template',
        'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
        'shipfox.labels': 'ubuntu22',
      },
    };
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instanceWithoutTemplateKey]}),
      client,
      tracker,
    });

    await lifecycle.observe();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({state: 'running'});
    expect(tracker.countsByTemplate().size).toBe(0);
  });
});

function makeLifecycle(
  args: {
    engine?: ReturnType<typeof fakeEngine>;
    client?: ReturnType<typeof fakeClient>;
    tracker?: ProviderRunnerTracker;
  } = {},
) {
  return createEc2Lifecycle({
    engine: args.engine ?? fakeEngine(),
    client: args.client ?? fakeClient(),
    identity: {id: '00000000-0000-4000-8000-000000000001', workspaceId: null},
    tracker: args.tracker ?? testTracker(),
    templates: [template],
    providerKind: 'ec2',
    now: () => NOW,
  });
}

function launch(): ProviderRunnerLaunch<Ec2TemplateSpec> {
  return {
    runnerInstanceId: RUNNER_INSTANCE_ID,
    providerRunnerId: 'runner-1',
    reservationId: '00000000-0000-4000-8000-000000000003',
    bootstrapToken: 'sf_rbt_secret',
    runnerEnv: {SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: 'sf_rbt_secret'},
    template,
  };
}

function instance(args: {
  state: Ec2InstanceView['state'];
  stateTransitionReason?: string;
}): Ec2InstanceView {
  return {
    instanceId: 'i-123',
    state: args.state,
    tags: {
      'shipfox.runner_instance_id': RUNNER_INSTANCE_ID,
      'shipfox.provider_runner_id': 'runner-1',
      'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
      'shipfox.reservation_id': '00000000-0000-4000-8000-000000000003',
      'shipfox.template_key': 'spot-small',
      'shipfox.labels': 'ubuntu22',
    },
    ...(args.stateTransitionReason ? {stateTransitionReason: args.stateTransitionReason} : {}),
  };
}

function fakeEngine(
  options: {instances?: Ec2InstanceView[]; runError?: Error; listError?: Error} = {},
): Ec2Engine & {runArgs: Parameters<Ec2Engine['runInstance']>[0][]} {
  const runArgs: Parameters<Ec2Engine['runInstance']>[0][] = [];
  return {
    runArgs,
    runInstance: (args) => {
      runArgs.push(args);
      return options.runError
        ? Promise.reject(options.runError)
        : Promise.resolve(instance({state: 'pending'}));
    },
    listManaged: () =>
      options.listError
        ? Promise.reject(options.listError)
        : Promise.resolve(options.instances ?? []),
    terminate: () => Promise.resolve(),
  };
}

function fakeClient(
  options: {reportErrors?: Error[]; attachResult?: {attached: boolean}} = {},
): ProvisionerClient & {
  reportBodies: ReportRunnerInstancesBodyDto[];
  attachments: Array<{runnerInstanceId: string; providerRunnerId: string}>;
} {
  const reportBodies: ReportRunnerInstancesBodyDto[] = [];
  const attachments: Array<{runnerInstanceId: string; providerRunnerId: string}> = [];
  const reportErrors = [...(options.reportErrors ?? [])];
  return {
    reportBodies,
    attachments,
    getIdentity: () =>
      Promise.resolve({id: 'provisioner', scope: 'installation', workspace_id: null}),
    pollDemand: () =>
      Promise.resolve({stats: [], reservations: [], terminate_provider_runner_ids: []}),
    createRunnerInstances: () => Promise.resolve({runner_instances: []}),
    attachRunnerInstanceProviderId: (runnerInstanceId, providerRunnerId) => {
      attachments.push({runnerInstanceId, providerRunnerId});
      return Promise.resolve(options.attachResult ?? {attached: true});
    },
    assignRunnerInstances: (_reservationId, runnerInstanceIds) =>
      Promise.resolve({runner_instance_ids: runnerInstanceIds}),
    reportRunnerInstances: (body) => {
      reportBodies.push(body);
      const error = reportErrors.shift();
      return error
        ? Promise.reject(error)
        : Promise.resolve({accepted: body.events.length, reservations_released: 0});
    },
    reconcileRunnerInstances: () =>
      Promise.resolve({runners: [], terminated_absent_provider_runner_ids: []}),
  };
}

function testTracker(): ProviderRunnerTracker {
  const runners = new Map<string, {templateKey: string; state: 'starting' | 'running'}>();
  return {
    recordStarting: ({providerRunnerId, templateKey}) =>
      runners.set(providerRunnerId, {templateKey, state: 'starting'}),
    markRunning: (providerRunnerId) => {
      const runner = runners.get(providerRunnerId);
      if (runner) runner.state = 'running';
    },
    remove: (providerRunnerId) => runners.delete(providerRunnerId),
    replaceAll: (nextRunners) => {
      runners.clear();
      for (const runner of nextRunners) runners.set(runner.providerRunnerId, {...runner});
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

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {response: {status}});
}
