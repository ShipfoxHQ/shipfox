import type {WorkflowsJobStepsSettledEvent} from '@shipfox/api-workflows-dto';
import {onJobStepsSettled} from './on-job-steps-settled.js';

const signalMock = vi.fn();
const getHandleMock = vi.fn(() => ({signal: signalMock}));

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {getHandle: getHandleMock}}),
}));

function buildPayload(
  overrides: Partial<WorkflowsJobStepsSettledEvent> = {},
): WorkflowsJobStepsSettledEvent {
  return {
    jobId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    status: 'succeeded',
    ...overrides,
  };
}

describe('onJobStepsSettled', () => {
  beforeEach(() => {
    getHandleMock.mockClear();
    signalMock.mockReset();
    signalMock.mockResolvedValue(undefined);
  });

  it('signals the job workflow with the settled status', async () => {
    const payload = buildPayload({status: 'failed'});

    await onJobStepsSettled(payload);

    expect(getHandleMock).toHaveBeenCalledWith(`job:${payload.jobId}`);
    expect(signalMock).toHaveBeenCalledWith('job-finished', {status: 'failed'});
  });

  it('discards a late event when the job workflow already terminated', async () => {
    const notFound = new Error('gone');
    notFound.name = 'WorkflowNotFoundError';
    signalMock.mockRejectedValueOnce(notFound);

    const result = onJobStepsSettled(buildPayload());

    await expect(result).resolves.toBeUndefined();
  });

  it('rethrows a non-terminal signal failure', async () => {
    const failure = new Error('temporal unavailable');
    signalMock.mockRejectedValueOnce(failure);

    const result = onJobStepsSettled(buildPayload());

    await expect(result).rejects.toBe(failure);
  });
});
