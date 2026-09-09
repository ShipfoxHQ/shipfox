import type {
  StepAttemptTerminalCauseDto,
  WorkflowsStepAttemptTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {onStepAttemptTerminated} from './on-step-attempt-terminated.js';

const {finalizeAttemptLogStreamMock} = vi.hoisted(() => ({
  finalizeAttemptLogStreamMock: vi.fn(),
}));

vi.mock('#core/finalize-attempt-stream.js', () => ({
  finalizeAttemptLogStream: finalizeAttemptLogStreamMock,
}));

function buildPayload(
  terminalCause: StepAttemptTerminalCauseDto | null | undefined,
): WorkflowsStepAttemptTerminatedEventDto {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    logOutcome: 'abandoned',
    terminalCause,
  };
}

describe('onStepAttemptTerminated', () => {
  beforeEach(() => {
    finalizeAttemptLogStreamMock.mockReset();
    finalizeAttemptLogStreamMock.mockResolvedValue(undefined);
  });

  it.each([
    {terminalCause: 'timed_out' as const, expectedCause: 'timed_out'},
    {terminalCause: 'run_cancelled' as const, expectedCause: 'run_cancelled'},
    {terminalCause: 'runner_lost' as const, expectedCause: 'runner_lost'},
    {terminalCause: null, expectedCause: null},
    {terminalCause: undefined, expectedCause: 'runner_lost'},
  ])('passes $expectedCause to stream finalization', async ({terminalCause, expectedCause}) => {
    const payload = buildPayload(terminalCause);

    await onStepAttemptTerminated(payload);

    expect(finalizeAttemptLogStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({terminalCause: expectedCause}),
    );
  });
});
