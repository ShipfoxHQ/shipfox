import {reconcileProvisionedRunnersFromDbResult} from './provisioned-runners.js';

describe('reconcileProvisionedRunnersFromDbResult', () => {
  it('keeps active provisioned runners', () => {
    const result = reconcileProvisionedRunnersFromDbResult({
      observedProvisionedRunnerIds: ['provisioned-runner-1'],
      observedRows: [provisionedRunner({provisionedRunnerId: 'provisioned-runner-1'})],
      boundJobExecutionsByProvisionedRunnerId: new Map(),
    });

    expect(result[0]?.desiredIntent).toBe('keep');
  });

  it('terminates terminal provisioned runners', () => {
    const result = reconcileProvisionedRunnersFromDbResult({
      observedProvisionedRunnerIds: ['provisioned-runner-1'],
      observedRows: [
        provisionedRunner({provisionedRunnerId: 'provisioned-runner-1', state: 'terminated'}),
      ],
      boundJobExecutionsByProvisionedRunnerId: new Map(),
    });

    expect(result[0]?.desiredIntent).toBe('terminate');
  });

  it('keeps orphan observed provisioned runners', () => {
    const result = reconcileProvisionedRunnersFromDbResult({
      observedProvisionedRunnerIds: ['provisioned-runner-1'],
      observedRows: [],
      boundJobExecutionsByProvisionedRunnerId: new Map(),
    });

    expect(result[0]).toMatchObject({
      provisionedRunnerId: 'provisioned-runner-1',
      state: null,
      desiredIntent: 'keep',
    });
  });

  it('terminates active provisioned runners with a cancelled latest bound job', () => {
    const result = reconcileProvisionedRunnersFromDbResult({
      observedProvisionedRunnerIds: ['provisioned-runner-1'],
      observedRows: [provisionedRunner({provisionedRunnerId: 'provisioned-runner-1'})],
      boundJobExecutionsByProvisionedRunnerId: new Map([
        [
          'provisioned-runner-1',
          boundJobExecution({
            provisionedRunnerId: 'provisioned-runner-1',
            cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
          }),
        ],
      ]),
    });

    expect(result[0]?.desiredIntent).toBe('terminate');
  });
});

function provisionedRunner(params: {
  provisionedRunnerId: string;
  state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
}) {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provisionerId: crypto.randomUUID(),
    provisionedRunnerId: params.provisionedRunnerId,
    reservationId: null,
    templateKey: 'linux',
    labels: ['linux'],
    state: params.state ?? 'running',
    reason: null,
    runnerSessionId: null,
    providerKind: 'docker',
    reportedAt: new Date(),
    startedAt: null,
    stoppingAt: null,
    stoppedAt: null,
    failedAt: null,
    terminatedAt: null,
    reservationReleasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function boundJobExecution(params: {
  provisionedRunnerId: string;
  cancellationRequestedAt?: Date | null;
}) {
  return {
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    provisionedRunnerId: params.provisionedRunnerId,
    startedAt: new Date('2025-01-01T00:00:00.000Z'),
    lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
    cancellationRequestedAt: params.cancellationRequestedAt ?? null,
  };
}
