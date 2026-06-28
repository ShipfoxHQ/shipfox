import type {WorkflowsWorkflowRunCancelledEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {RUN_CANCEL_SIGNAL} from '#temporal/constants.js';
import {isWorkflowNotFound} from '#temporal/workflow-not-found.js';

export async function onWorkflowRunCancelled(
  payload: WorkflowsWorkflowRunCancelledEvent,
): Promise<void> {
  logger().info({runId: payload.runId}, 'Signaling run orchestration cancellation');
  const handle = temporalClient().workflow.getHandle(`run:${payload.runId}`);
  try {
    await handle.signal(RUN_CANCEL_SIGNAL);
  } catch (err) {
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {runId: payload.runId},
        'Run workflow already terminated; cancel event discarded',
      );
      return;
    }
    throw err;
  }
}
