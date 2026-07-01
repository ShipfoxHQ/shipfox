import type {WorkflowsJobExecutionTimedOutEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {requestJobExecutionCancellation} from '#db/job-executions.js';

export async function onWorkflowsJobExecutionTimedOut(
  payload: WorkflowsJobExecutionTimedOutEventDto,
): Promise<void> {
  logger().info(
    {
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
    },
    'Requesting runner cancellation for timed-out job execution',
  );
  await requestJobExecutionCancellation({jobExecutionId: payload.jobExecutionId});
}
