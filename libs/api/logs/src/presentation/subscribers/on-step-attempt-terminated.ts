import type {WorkflowsStepAttemptTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {finalizeAttemptLogStream} from '#core/finalize-attempt-stream.js';

export async function onStepAttemptTerminated(
  payload: WorkflowsStepAttemptTerminatedEventDto,
): Promise<void> {
  try {
    await finalizeAttemptLogStream({
      jobId: payload.jobId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      stepId: payload.stepId,
      attempt: payload.attempt,
      logOutcome: payload.logOutcome,
      // Preserve the old runner-loss behavior for pre-change events while new
      // producers use null to distinguish an abandoned drain from runner loss.
      terminalCause: payload.terminalCause === undefined ? 'runner_lost' : payload.terminalCause,
    });
  } catch (error) {
    // The project was deleted, so there is no stream to finalize and none to create.
    if (error instanceof ScopeDeletedError) return;
    throw error;
  }
}
