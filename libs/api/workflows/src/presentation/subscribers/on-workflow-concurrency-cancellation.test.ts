import type {
  WorkflowsWorkflowConcurrencyHolderCancellationRequestedEventDto,
  WorkflowsWorkflowConcurrencyWaiterSupersededEventDto,
} from '@shipfox/api-workflows-dto';
import {
  onWorkflowRunConcurrencyHolderCancellationRequested,
  onWorkflowRunConcurrencyWaiterSuperseded,
} from './on-workflow-concurrency-cancellation.js';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  recordCancellationOutcome: vi.fn(),
  signalCancellation: vi.fn(),
}));
const {cancel: cancelMock, recordCancellationOutcome: recordCancellationOutcomeMock} = mocks;
const {signalCancellation: signalCancellationMock} = mocks;

vi.mock('#db/workflow-runs/run-status.js', () => ({
  cancelWorkflowRunAttemptForConcurrencyWithOutcome: mocks.cancel,
}));
vi.mock('#metrics/instance.js', () => ({
  recordWorkflowConcurrencyCancellationOutcome: mocks.recordCancellationOutcome,
}));
vi.mock('./on-workflow-run-cancelled.js', () => ({
  onWorkflowRunCancelled: mocks.signalCancellation,
}));

function buildPayload(
  overrides: Partial<WorkflowsWorkflowConcurrencyWaiterSupersededEventDto> = {},
): WorkflowsWorkflowConcurrencyWaiterSupersededEventDto {
  return {
    projectId: crypto.randomUUID(),
    claimId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    supersededByClaimId: crypto.randomUUID(),
    supersededByWorkflowRunId: crypto.randomUUID(),
    supersededByWorkflowRunAttemptId: crypto.randomUUID(),
    ...overrides,
  };
}

function buildHolderCancellationPayload(): WorkflowsWorkflowConcurrencyHolderCancellationRequestedEventDto {
  return {
    projectId: crypto.randomUUID(),
    claimId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    requestingClaimId: crypto.randomUUID(),
    requestingWorkflowRunId: crypto.randomUUID(),
    requestingWorkflowRunAttemptId: crypto.randomUUID(),
  };
}

type CancellationPayload =
  | WorkflowsWorkflowConcurrencyHolderCancellationRequestedEventDto
  | WorkflowsWorkflowConcurrencyWaiterSupersededEventDto;

async function assertCancellation<T extends CancellationPayload>(
  handle: (payload: T) => Promise<void>,
  payload: T,
): Promise<void> {
  await handle(payload);

  expect(cancelMock).toHaveBeenCalledWith({
    workflowRunAttemptId: payload.workflowRunAttemptId,
  });
  expect(signalCancellationMock).toHaveBeenCalledWith({
    workflowRunId: payload.workflowRunId,
    workflowRunAttemptId: payload.workflowRunAttemptId,
    projectId: payload.projectId,
  });
  expect(recordCancellationOutcomeMock).toHaveBeenCalledWith('completed');
  expect(recordCancellationOutcomeMock).toHaveBeenCalledTimes(1);
  expect(cancelMock.mock.invocationCallOrder[0]).toBeLessThan(
    signalCancellationMock.mock.invocationCallOrder[0] as number,
  );
}

function resetMocks(): void {
  cancelMock.mockReset();
  signalCancellationMock.mockReset();
  recordCancellationOutcomeMock.mockReset();
  cancelMock.mockResolvedValue({run: {}, changed: true});
  signalCancellationMock.mockResolvedValue(undefined);
}

describe('onWorkflowRunConcurrencyWaiterSuperseded', () => {
  beforeEach(resetMocks);

  it('cancels the affected attempt and notifies orchestration after the terminal commit', async () => {
    await assertCancellation(onWorkflowRunConcurrencyWaiterSuperseded, buildPayload());
  });

  it('does not notify orchestration when the terminal operation is already a no-op', async () => {
    cancelMock.mockResolvedValueOnce({run: {}, changed: false});

    await onWorkflowRunConcurrencyWaiterSuperseded(buildPayload());

    expect(signalCancellationMock).not.toHaveBeenCalled();
    expect(recordCancellationOutcomeMock).toHaveBeenCalledWith('no_op');
  });
});

describe('onWorkflowRunConcurrencyHolderCancellationRequested', () => {
  beforeEach(resetMocks);

  it('cancels the affected attempt and notifies orchestration after the terminal commit', async () => {
    await assertCancellation(
      onWorkflowRunConcurrencyHolderCancellationRequested,
      buildHolderCancellationPayload(),
    );
  });

  it('does not notify orchestration when the terminal operation is already a no-op', async () => {
    cancelMock.mockResolvedValueOnce({run: {}, changed: false});

    await onWorkflowRunConcurrencyHolderCancellationRequested(buildHolderCancellationPayload());

    expect(signalCancellationMock).not.toHaveBeenCalled();
    expect(recordCancellationOutcomeMock).toHaveBeenCalledWith('no_op');
  });
});
