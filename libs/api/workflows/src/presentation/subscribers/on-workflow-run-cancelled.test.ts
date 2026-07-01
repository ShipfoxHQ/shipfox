import type {WorkflowsWorkflowRunCancelledEventDto} from '@shipfox/api-workflows-dto';
import {onWorkflowRunCancelled} from './on-workflow-run-cancelled.js';

const signalMock = vi.fn();
const getHandleMock = vi.fn(() => ({signal: signalMock}));

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {getHandle: getHandleMock}}),
}));

function buildPayload(
  overrides: Partial<WorkflowsWorkflowRunCancelledEventDto> = {},
): WorkflowsWorkflowRunCancelledEventDto {
  return {
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    ...overrides,
  };
}

describe('onWorkflowRunCancelled', () => {
  beforeEach(() => {
    getHandleMock.mockClear();
    signalMock.mockReset();
    signalMock.mockResolvedValue(undefined);
  });

  it('signals the run workflow that cancellation was requested', async () => {
    const payload = buildPayload();

    await onWorkflowRunCancelled(payload);

    expect(getHandleMock).toHaveBeenCalledWith(
      `workflow-run-attempt:${payload.workflowRunAttemptId}`,
    );
    expect(signalMock).toHaveBeenCalledWith('run-cancel');
  });

  it('discards a late event when the run workflow already terminated', async () => {
    const notFound = new Error('gone');
    notFound.name = 'WorkflowNotFoundError';
    signalMock.mockRejectedValueOnce(notFound);

    const result = onWorkflowRunCancelled(buildPayload());

    await expect(result).resolves.toBeUndefined();
    expect(signalMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-terminal signal failure', async () => {
    const failure = new Error('temporal unavailable');
    signalMock.mockRejectedValueOnce(failure);

    const result = onWorkflowRunCancelled(buildPayload());

    await expect(result).rejects.toBe(failure);
  });
});
