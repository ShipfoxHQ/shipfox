import type {WorkflowsStepAttemptTerminatedEvent} from '@shipfox/api-workflows-dto';
import {finalizeAttemptLogStream} from '#core/finalize-attempt-stream.js';

export async function onStepAttemptTerminated(
  payload: WorkflowsStepAttemptTerminatedEvent,
): Promise<void> {
  await finalizeAttemptLogStream({
    jobId: payload.jobId,
    workflowRunAttemptId: payload.workflowRunAttemptId,
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
    stepId: payload.stepId,
    attempt: payload.attempt,
    logOutcome: payload.logOutcome,
  });
}
