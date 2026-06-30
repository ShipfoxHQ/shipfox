import type {
  MintRegistrationTokensBatchBodyDto,
  MintRegistrationTokensBatchResponseDto,
  PollDemandBodyDto,
  PollDemandResponseDto,
} from '@shipfox/api-runners-dto';
import type {ProvisionerClient} from '#api-client.js';
import {runProvisionerTick} from '#tick.js';
import {createInMemoryTracker, type ProvisionedRunnerTracker} from '#tracker.js';
import type {ProvisionedRunnerLaunch, ProvisionerTemplate} from '#types.js';

const EXPIRES_AT = '2026-01-01T00:00:00.000Z';

function ubuntuTemplate(
  overrides: Partial<ProvisionerTemplate<null>> & {key: string},
): ProvisionerTemplate<null> {
  return {
    labels: ['ubuntu22'],
    maxConcurrency: 5,
    cost: 1,
    spec: null,
    ...overrides,
  };
}

interface Harness {
  readonly pollBodies: PollDemandBodyDto[];
  readonly mintBodies: MintRegistrationTokensBatchBodyDto[];
  readonly launches: ProvisionedRunnerLaunch<null>[];
  readonly client: ProvisionerClient;
  readonly tracker: ProvisionedRunnerTracker;
}

function harness(options: {response: PollDemandResponseDto; mintError?: Error}): Harness {
  const pollBodies: PollDemandBodyDto[] = [];
  const mintBodies: MintRegistrationTokensBatchBodyDto[] = [];
  const launches: ProvisionedRunnerLaunch<null>[] = [];

  const client: ProvisionerClient = {
    getIdentity: () => Promise.resolve({id: 'provisioner', workspace_id: 'workspace'}),
    pollDemand: (body) => {
      pollBodies.push(body);
      return Promise.resolve(options.response);
    },
    mintRegistrationTokens: (body): Promise<MintRegistrationTokensBatchResponseDto> => {
      mintBodies.push(body);
      if (options.mintError) return Promise.reject(options.mintError);
      return Promise.resolve({
        tokens: body.provisioned_runners.map((runner) => ({
          provisioned_runner_id: runner.provisioned_runner_id,
          registration_token: `sfrt_${runner.provisioned_runner_id}`,
          expires_at: EXPIRES_AT,
        })),
      });
    },
    reportProvisionedRunners: () => Promise.resolve({accepted: 0, reservations_released: 0}),
  };

  return {pollBodies, mintBodies, launches, client, tracker: createInMemoryTracker()};
}

function reservation(count: number, labels: string[] = ['ubuntu22'], id = 'r1') {
  return {reservation_id: id, labels, count, expires_at: EXPIRES_AT};
}

function runTick(
  fixture: Harness,
  params: {
    templates: ProvisionerTemplate<null>[];
    maxReservations?: number;
    batchSize?: number;
  },
) {
  return runProvisionerTick({
    client: fixture.client,
    templates: params.templates,
    tracker: fixture.tracker,
    launch: (launch) => {
      fixture.launches.push(launch);
      return Promise.resolve();
    },
    buildRunnerEnv: ({registrationToken}) => ({SHIPFOX_RUNNER_TOKEN: registrationToken}),
    maxReservations: params.maxReservations ?? 250,
    waitSeconds: 30,
    registrationTokenBatchSize: params.batchSize ?? 250,
  });
}

describe('runProvisionerTick', () => {
  it('advertises free capacity and mints one token per reserved slot', async () => {
    const template = ubuntuTemplate({key: 'small'});
    const fixture = harness({response: {stats: [], reservations: [reservation(3)]}});

    const result = await runTick(fixture, {templates: [template]});

    expect(fixture.pollBodies[0]).toMatchObject({
      max_reservations: 5,
      templates: [{template_key: 'small', available_slots: 5, starting: 0, running: 0}],
    });
    expect(fixture.mintBodies[0]?.reservation_id).toBe('r1');
    expect(fixture.mintBodies[0]?.provisioned_runners).toHaveLength(3);
    expect(fixture.launches).toHaveLength(3);
    expect(result).toMatchObject({
      reservationCount: 1,
      plannedCount: 3,
      launchAttemptedCount: 3,
      launchedCount: 3,
    });
  });

  it('injects the minted token into the runner env and tracks each as starting', async () => {
    const template = ubuntuTemplate({key: 'small'});
    const fixture = harness({response: {stats: [], reservations: [reservation(2)]}});

    await runTick(fixture, {templates: [template]});

    for (const launch of fixture.launches) {
      expect(launch.template.key).toBe('small');
      expect(launch.runnerEnv.SHIPFOX_RUNNER_TOKEN).toBe(`sfrt_${launch.provisionedRunnerId}`);
    }
    expect(fixture.tracker.countsByTemplate()).toEqual(
      new Map([['small', {starting: 2, running: 0}]]),
    );
  });

  it('asks for no reservations once a template is at its concurrency cap', async () => {
    const template = ubuntuTemplate({key: 'small', maxConcurrency: 5});
    const fixture = harness({response: {stats: [], reservations: [reservation(3)]}});
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      fixture.tracker.recordStarting({provisionedRunnerId: id, templateKey: 'small'});
    }

    const result = await runTick(fixture, {templates: [template]});

    expect(fixture.pollBodies[0]).toMatchObject({
      max_reservations: 0,
      templates: [{template_key: 'small', available_slots: 0, starting: 5}],
    });
    expect(fixture.mintBodies).toHaveLength(0);
    expect(fixture.launches).toHaveLength(0);
    expect(result.launchedCount).toBe(0);
  });

  it('caps reservations and launches at the remaining free slots', async () => {
    const template = ubuntuTemplate({key: 'small', maxConcurrency: 5});
    const fixture = harness({response: {stats: [], reservations: [reservation(10)]}});
    fixture.tracker.recordStarting({provisionedRunnerId: 'a', templateKey: 'small'});
    fixture.tracker.recordStarting({provisionedRunnerId: 'b', templateKey: 'small'});

    await runTick(fixture, {templates: [template]});

    expect(fixture.pollBodies[0]?.max_reservations).toBe(3);
    expect(fixture.launches).toHaveLength(3);
  });

  it('caps the requested reservations at the configured maximum', async () => {
    const template = ubuntuTemplate({key: 'small', maxConcurrency: 1000});
    const fixture = harness({response: {stats: [], reservations: []}});

    await runTick(fixture, {templates: [template], maxReservations: 100});

    expect(fixture.pollBodies[0]?.max_reservations).toBe(100);
  });

  it('mints in batches no larger than the configured batch size', async () => {
    const template = ubuntuTemplate({key: 'small', maxConcurrency: 10});
    const fixture = harness({response: {stats: [], reservations: [reservation(5)]}});

    await runTick(fixture, {templates: [template], batchSize: 2});

    expect(fixture.mintBodies.map((body) => body.provisioned_runners.length)).toEqual([2, 2, 1]);
    expect(fixture.launches).toHaveLength(5);
  });

  it('frees the slots and launches nothing when minting fails', async () => {
    const template = ubuntuTemplate({key: 'small'});
    const fixture = harness({
      response: {stats: [], reservations: [reservation(2)]},
      mintError: new Error('reservation expired'),
    });

    const result = await runTick(fixture, {templates: [template]});

    expect(fixture.launches).toHaveLength(0);
    expect(result.launchedCount).toBe(0);
    expect(fixture.tracker.countsByTemplate()).toEqual(new Map());
  });

  it('mints and launches nothing once shutdown is signalled before the launch phase', async () => {
    const template = ubuntuTemplate({key: 'small'});
    const fixture = harness({response: {stats: [], reservations: [reservation(2)]}});
    const controller = new AbortController();
    controller.abort();

    const result = await runProvisionerTick({
      client: fixture.client,
      templates: [template],
      tracker: fixture.tracker,
      launch: (launch) => {
        fixture.launches.push(launch);
        return Promise.resolve();
      },
      buildRunnerEnv: ({registrationToken}) => ({SHIPFOX_RUNNER_TOKEN: registrationToken}),
      maxReservations: 250,
      waitSeconds: 30,
      registrationTokenBatchSize: 250,
      signal: controller.signal,
    });

    expect(fixture.mintBodies).toHaveLength(0);
    expect(fixture.launches).toHaveLength(0);
    expect(result.launchedCount).toBe(0);
  });

  it('launches only the runners that received a token when mint returns a shortfall', async () => {
    const template = ubuntuTemplate({key: 'small'});
    const launches: ProvisionedRunnerLaunch<null>[] = [];
    const tracker = createInMemoryTracker();
    const client: ProvisionerClient = {
      getIdentity: () => Promise.resolve({id: 'p', workspace_id: 'w'}),
      pollDemand: () => Promise.resolve({stats: [], reservations: [reservation(2)]}),
      mintRegistrationTokens: (body) =>
        Promise.resolve({
          tokens: body.provisioned_runners.slice(0, 1).map((runner) => ({
            provisioned_runner_id: runner.provisioned_runner_id,
            registration_token: `sfrt_${runner.provisioned_runner_id}`,
            expires_at: EXPIRES_AT,
          })),
        }),
      reportProvisionedRunners: () => Promise.resolve({accepted: 0, reservations_released: 0}),
    };

    const result = await runProvisionerTick({
      client,
      templates: [template],
      tracker,
      launch: (launch) => {
        launches.push(launch);
        return Promise.resolve();
      },
      buildRunnerEnv: ({registrationToken}) => ({SHIPFOX_RUNNER_TOKEN: registrationToken}),
      maxReservations: 250,
      waitSeconds: 30,
      registrationTokenBatchSize: 250,
    });

    expect(launches).toHaveLength(1);
    expect(result.launchAttemptedCount).toBe(1);
    expect(result.launchedCount).toBe(1);
  });

  it('frees the slot on a launch failure: it mints, removes the runner, and does not throw', async () => {
    const template = ubuntuTemplate({key: 'small'});
    const fixture = harness({response: {stats: [], reservations: [reservation(1)]}});

    const result = await runProvisionerTick({
      client: fixture.client,
      templates: [template],
      tracker: fixture.tracker,
      launch: () => Promise.reject(new Error('docker daemon down')),
      buildRunnerEnv: ({registrationToken}) => ({SHIPFOX_RUNNER_TOKEN: registrationToken}),
      maxReservations: 250,
      waitSeconds: 30,
      registrationTokenBatchSize: 250,
    });

    expect(fixture.mintBodies).toHaveLength(1);
    expect(result.launchAttemptedCount).toBe(1);
    expect(result.launchedCount).toBe(0);
    // The failed runner must not keep occupying a slot, or a persistent failure wedges the loop.
    expect(fixture.tracker.countsByTemplate()).toEqual(new Map());
  });
});
