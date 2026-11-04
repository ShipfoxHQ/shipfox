import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  deleteProjectSecretRows,
  markProjectSecretsPurged,
  recordProjectSecretsDeleted,
} from '#db/index.js';

/**
 * Blocks later writes for the deleted project, then deletes its secrets and variables.
 * Workspace-level rows stay. Every step is safe to repeat, because the outbox redelivers.
 */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  const {workspaceId, projectId} = event;
  await recordProjectSecretsDeleted({workspaceId, projectId});
  const deleted = await deleteProjectSecretRows({projectId});
  const purged = await markProjectSecretsPurged({workspaceId, projectId});
  logger().info({workspaceId, projectId, ...deleted, purged}, 'project deleted: purged secrets');
}
