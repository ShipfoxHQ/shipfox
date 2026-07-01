import type {WorkflowsWorkflowRunCancelledEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {RUN_CANCEL_SIGNAL} from '#temporal/constants.js';
import {isWorkflowNotFound} from '#temporal/workflow-not-found.js';

export async function onWorkflowRunCancelled(
  payload: WorkflowsWorkflowRunCancelledEvent,
): Promise<void> {
  logger().info(
    {workflowRunId: payload.workflowRunId, workflowRunAttemptId: payload.workflowRunAttemptId},
    'Signaling run attempt orchestration cancellation',
  );
  const handle = temporalClient().workflow.getHandle(`run-attempt:${payload.workflowRunAttemptId}`);
  try {
    await handle.signal(RUN_CANCEL_SIGNAL);
  } catch (err) {
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {workflowRunId: payload.workflowRunId, workflowRunAttemptId: payload.workflowRunAttemptId},
        'Run attempt workflow already terminated; cancel event discarded',
      );
      return;
    }
    throw err;
  }
}
