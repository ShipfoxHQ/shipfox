import type {WorkflowsJobExecutionQueuedEventDto} from '@shipfox/api-workflows-dto';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {logger} from '@shipfox/node-opentelemetry';
import {enqueueJobExecution} from '#db/job-executions.js';

export async function onWorkflowsJobExecutionQueued(
  payload: WorkflowsJobExecutionQueuedEventDto,
): Promise<void> {
  logger().info(
    {
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
    },
    'Queueing runner job execution from workflow fact',
  );
  try {
    await enqueueJobExecution({
      workspaceId: payload.workspaceId,
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
      projectId: payload.projectId,
      requiredLabels: payload.requiredLabels,
      queuedAt: new Date(payload.queuedAt),
    });
  } catch (error) {
    // The project was deleted, so its job has no run to queue for.
    if (error instanceof ScopeDeletedError) return;
    throw error;
  }
}
