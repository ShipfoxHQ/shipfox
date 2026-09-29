import type {RunnerJobExecutionPlacementDeniedEvent} from '@shipfox/api-runners-dto';
import {onRunnerJobExecutionPlacementDenied} from './on-runner-job-execution-placement-denied.js';

const signalMock = vi.fn();
const getHandleMock = vi.fn(() => ({signal: signalMock}));

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {getHandle: getHandleMock}}),
}));

function buildPayload(): RunnerJobExecutionPlacementDeniedEvent {
  return {
    workspaceId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    notice: {
      reason: 'machine-not-allowed',
      message: 'This workspace cannot use 16 vCPU runners.',
      requiredAction: {reason: 'add-credits', message: 'Add credits', url: '/settings/billing'},
    },
  };
}

describe('onRunnerJobExecutionPlacementDenied', () => {
  beforeEach(() => {
    getHandleMock.mockClear();
    signalMock.mockReset();
    signalMock.mockResolvedValue(undefined);
  });

  it('signals the job workflow with the denial notice', async () => {
    const payload = buildPayload();

    await onRunnerJobExecutionPlacementDenied(payload);

    expect(getHandleMock).toHaveBeenCalledWith(`job:${payload.jobId}`);
    expect(signalMock).toHaveBeenCalledWith('job-placement-denied', {
      jobExecutionId: payload.jobExecutionId,
      notice: payload.notice,
    });
  });

  it('drops the event when the job workflow already terminated', async () => {
    signalMock.mockRejectedValue(
      Object.assign(new Error('not found'), {name: 'WorkflowNotFoundError'}),
    );

    await expect(onRunnerJobExecutionPlacementDenied(buildPayload())).resolves.toBeUndefined();
  });

  it('rethrows other signal failures so the dispatcher retries', async () => {
    signalMock.mockRejectedValue(new Error('temporal unavailable'));

    await expect(onRunnerJobExecutionPlacementDenied(buildPayload())).rejects.toThrow(
      'temporal unavailable',
    );
  });
});
