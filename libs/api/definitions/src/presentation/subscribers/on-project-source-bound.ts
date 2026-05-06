import type {ProjectSourceBoundEvent} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';
import {DEFINITION_SYNC_WORKFLOW, DEFINITIONS_TASK_QUEUE} from '#temporal/index.js';

export async function onProjectSourceBound(event: DomainEvent): Promise<void> {
  const payload = event.payload as ProjectSourceBoundEvent;
  const workflowId = buildWorkflowId(payload);

  try {
    await temporalClient().workflow.start(DEFINITION_SYNC_WORKFLOW, {
      taskQueue: DEFINITIONS_TASK_QUEUE,
      workflowId,
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
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
    logger().error(
      {
        err: error,
        workflowId,
        projectId: payload.projectId,
        sourceConnectionId: payload.sourceConnectionId,
      },
      'Failed to start definition sync workflow',
    );
    throw error;
  }
}

function buildWorkflowId(payload: ProjectSourceBoundEvent): string {
  return `definition-sync:${payload.projectId}:${payload.sourceConnectionId}:${payload.externalRepositoryId}`;
}
