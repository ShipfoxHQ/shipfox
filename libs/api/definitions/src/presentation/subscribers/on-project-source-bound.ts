import type {ProjectSourceBoundEvent} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';
import {DEFINITIONS_TASK_QUEUE} from '#temporal/index.js';

export async function onProjectSourceBound(event: DomainEvent): Promise<void> {
  const payload = event.payload as ProjectSourceBoundEvent;

  try {
    await temporalClient().workflow.start('definitionSyncWorkflow', {
      taskQueue: DEFINITIONS_TASK_QUEUE,
      workflowId: `definition-sync:${payload.projectId}:${payload.externalRepositoryId}`,
      args: [
        {
          projectId: payload.projectId,
          workspaceId: payload.workspaceId,
          sourceConnectionId: payload.sourceConnectionId,
          sourceExternalRepositoryId: payload.externalRepositoryId,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
      logger().info({projectId: payload.projectId}, 'Definition sync workflow already started');
      return;
    }
    throw error;
  }
}
