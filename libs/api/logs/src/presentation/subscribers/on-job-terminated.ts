import type {WorkflowsJobTerminatedEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';
import {config} from '#config.js';
import {LOGS_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

/**
 * A job reached a terminal state (any path: completion, cancellation, lease-expiry,
 * timeout). Arm the grace-then-close workflow for any of its streams the runner never
 * ended itself. Deduped by workflow id, so a redelivered event is a no-op.
 */
export async function onJobTerminated(event: DomainEvent): Promise<void> {
  const payload = event.payload as WorkflowsJobTerminatedEvent;

  try {
    await temporalClient().workflow.start('closeAbandonedStreams', {
      taskQueue: LOGS_LIFECYCLE_TASK_QUEUE,
      workflowId: `logs-close:${payload.jobId}`,
      args: [{jobId: payload.jobId, graceSeconds: config.LOG_STREAM_CLOSE_GRACE_SECONDS}],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
      logger().debug({jobId: payload.jobId}, 'Close-abandoned-streams workflow already started');
      return;
    }
    throw error;
  }
}
