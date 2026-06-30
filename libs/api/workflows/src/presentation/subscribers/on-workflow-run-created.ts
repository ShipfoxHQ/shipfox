import type {WorkflowsRunAttemptCreatedEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {WORKFLOWS_TASK_QUEUE} from '#temporal/constants.js';

export async function onRunAttemptCreated(payload: WorkflowsRunAttemptCreatedEvent): Promise<void> {
  logger().info(
    {workflowRunId: payload.workflowRunId, workflowRunAttemptId: payload.workflowRunAttemptId},
    'Starting workflow run attempt orchestration',
  );
  try {
    await temporalClient().workflow.start('runOrchestration', {
      taskQueue: WORKFLOWS_TASK_QUEUE,
      workflowId: `run-attempt:${payload.workflowRunAttemptId}`,
      args: [
        {
          runId: payload.workflowRunId,
          runAttemptId: payload.workflowRunAttemptId,
          workspaceId: payload.workspaceId,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
      logger().info(
        {
          workflowRunId: payload.workflowRunId,
          workflowRunAttemptId: payload.workflowRunAttemptId,
        },
        'Orchestration already started, skipping',
      );
      return;
    }
    throw error;
  }
}

export const onWorkflowRunCreated = onRunAttemptCreated;
