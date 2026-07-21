import type {ProvisionerClient} from './api-client.js';
import {runProvisionerTick} from './tick.js';
import {createInMemoryTracker} from './tracker.js';

describe('runProvisionerTick', () => {
  it('creates runner instances with bootstrap tokens before launching demand-driven runners', async () => {
    const calls: string[] = [];
    const client: ProvisionerClient = {
      getIdentity: async () => ({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: async () => ({
        stats: [],
        reservations: [
          {
            reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001',
            labels: ['linux'],
            count: 1,
            expires_at: '2026-07-21T12:00:00.000Z',
          },
        ],
        terminate_provider_runner_ids: [],
      }),
      createRunnerInstances: () => {
        calls.push('create');
        return Promise.resolve({
          runner_instances: [
            {
              runner_instance_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0002',
              bootstrap_token: 'sf_rbt_test',
            },
          ],
        });
      },
      attachRunnerInstanceProviderId: async () => ({attached: true}),
      assignRunnerInstances: async (_reservationId, runnerInstanceIds) => ({
        runner_instance_ids: runnerInstanceIds,
      }),
      reportRunnerInstances: async () => ({accepted: 0, reservations_released: 0}),
      reconcileRunnerInstances: async () => ({
        runners: [],
        terminated_absent_provider_runner_ids: [],
      }),
    };
    const launches: string[] = [];

    await runProvisionerTick({
      client,
      templates: [{key: 'linux', labels: ['linux'], maxConcurrency: 1, cost: 1, spec: null}],
      tracker: createInMemoryTracker(),
      launch: (launch) => {
        calls.push('launch');
        launches.push(launch.bootstrapToken ?? '');
        return Promise.resolve();
      },
      buildRunnerEnv: ({bootstrapToken}) => ({
        SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken ?? '',
      }),
      maxReservations: 1,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
    });

    expect(calls).toEqual(['create', 'launch']);
    expect(launches).toEqual(['sf_rbt_test']);
  });
});
