import type {WorkflowsWorkflowConcurrencyAcquiredEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {RUN_CONCURRENCY_ACQUIRED_SIGNAL} from '#temporal/constants.js';
import {isWorkflowNotFound} from '#temporal/workflow-not-found.js';

export async function onWorkflowRunConcurrencyAcquired(
  payload: WorkflowsWorkflowConcurrencyAcquiredEventDto,
): Promise<void> {
  const handle = temporalClient().workflow.getHandle(
    `workflow-run-attempt:${payload.workflowRunAttemptId}`,
  );
  try {
    await handle.signal(RUN_CONCURRENCY_ACQUIRED_SIGNAL);
  } catch (error) {
    if (isWorkflowNotFound(error)) {
      logger().debug(
        {workflowRunId: payload.workflowRunId, workflowRunAttemptId: payload.workflowRunAttemptId},
        'Promoted run attempt orchestration is no longer running',
      );
      return;
    }
    throw error;
  }
}
