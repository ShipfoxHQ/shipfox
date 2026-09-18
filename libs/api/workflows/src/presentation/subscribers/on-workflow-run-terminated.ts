import type {WorkflowsWorkflowRunTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {releaseWorkflowConcurrencyClaimForAttempt} from '#db/workflow-concurrency.js';

export async function onWorkflowRunTerminated(
  payload: WorkflowsWorkflowRunTerminatedEventDto,
): Promise<void> {
  await releaseWorkflowConcurrencyClaimForAttempt(payload.workflowRunAttemptId);
}
