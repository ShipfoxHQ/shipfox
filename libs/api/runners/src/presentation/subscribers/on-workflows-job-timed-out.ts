import type {WorkflowsJobTimedOutEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {requestJobCancellation} from '#db/jobs.js';

/**
 * The workflow has decided this job timed out and emitted WORKFLOWS_JOB_TIMED_OUT
 * in the same transaction as the status update. We set the cancellation flag on
 * the running_jobs row so the runner picks it up on its next heartbeat.
 *
 * `requestJobCancellation` is idempotent (`COALESCE(cancellation_requested_at, now())`),
 * so at-least-once redelivery from the dispatcher is safe with no special handling.
 */
export async function onWorkflowsJobTimedOut(event: DomainEvent): Promise<void> {
  const payload = event.payload as WorkflowsJobTimedOutEvent;
  logger().info({jobId: payload.jobId}, 'Requesting runner cancellation for timed-out job');
  await requestJobCancellation({jobId: payload.jobId});
}
