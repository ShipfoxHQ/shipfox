import type {
  StepAttemptTerminalCauseDto,
  WorkflowsStepAttemptTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
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

  it('skips the event of a deleted project', async () => {
    const payload = buildPayload(null);
    finalizeAttemptLogStreamMock.mockRejectedValue(
      new ScopeDeletedError({workspaceId: payload.workspaceId, projectId: payload.projectId}),
    );

    await expect(onStepAttemptTerminated(payload)).resolves.toBeUndefined();
  });

  it('still fails on any other error, so the event is redelivered', async () => {
    finalizeAttemptLogStreamMock.mockRejectedValue(new Error('database down'));

    await expect(onStepAttemptTerminated(buildPayload(null))).rejects.toThrow('database down');
  });
});
