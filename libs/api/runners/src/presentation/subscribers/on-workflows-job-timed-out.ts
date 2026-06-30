import type {WorkflowsJobTimedOutEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {requestJobCancellation} from '#db/job-executions.js';

export async function onWorkflowsJobTimedOut(payload: WorkflowsJobTimedOutEvent): Promise<void> {
  logger().info({jobId: payload.jobId}, 'Requesting runner cancellation for timed-out job');
  await requestJobCancellation({jobId: payload.jobId});
}
