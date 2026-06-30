import type {RunnerJobLeaseExpiredEvent} from '@shipfox/api-runners-dto';
import {onRunnerJobLeaseExpired} from './on-runner-job-lease-expired.js';

const signalMock = vi.fn();
const getHandleMock = vi.fn(() => ({signal: signalMock}));

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {getHandle: getHandleMock}}),
}));

function buildPayload(
  overrides: Partial<RunnerJobLeaseExpiredEvent> = {},
): RunnerJobLeaseExpiredEvent {
  return {
    jobId: crypto.randomUUID(),
    executionId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    ...overrides,
  };
}

describe('onRunnerJobLeaseExpired', () => {
  beforeEach(() => {
    getHandleMock.mockClear();
    signalMock.mockReset();
    signalMock.mockResolvedValue(undefined);
  });

  it('signals the job workflow that its lease expired', async () => {
    const payload = buildPayload();

    await onRunnerJobLeaseExpired(payload);

    expect(getHandleMock).toHaveBeenCalledWith(`job:${payload.jobId}`);
    expect(signalMock).toHaveBeenCalledWith('job-lease-expired');
  });

  it('discards a late event when the job workflow already terminated', async () => {
    const notFound = new Error('gone');
    notFound.name = 'WorkflowNotFoundError';
    signalMock.mockRejectedValueOnce(notFound);

    const result = onRunnerJobLeaseExpired(buildPayload());

    await expect(result).resolves.toBeUndefined();
    expect(signalMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-terminal signal failure', async () => {
    const failure = new Error('temporal unavailable');
    signalMock.mockRejectedValueOnce(failure);

    const result = onRunnerJobLeaseExpired(buildPayload());

    await expect(result).rejects.toBe(failure);
  });
});
