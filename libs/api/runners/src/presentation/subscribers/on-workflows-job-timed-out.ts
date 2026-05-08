import type {WorkflowsJobTimedOutEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {requestJobCancellation} from '#db/jobs.js';

export async function onWorkflowsJobTimedOut(event: DomainEvent): Promise<void> {
  const payload = event.payload as WorkflowsJobTimedOutEvent;
  logger().info({jobId: payload.jobId}, 'Requesting runner cancellation for timed-out job');
  await requestJobCancellation({jobId: payload.jobId});
}
