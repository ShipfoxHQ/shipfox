import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {deleteManagedProjectRepository} from '#core/managed-repositories.js';

/**
 * Deletes the project's managed repository, with its objects and refs. A repository the project
 * linked is not touched, because it belongs to the provider account. Safe to repeat, because the
 * outbox redelivers.
 */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  const deleted = await deleteManagedProjectRepository({
    workspaceId: event.workspaceId,
    projectId: event.projectId,
  });
  logger().info(
    {projectId: event.projectId, workspaceId: event.workspaceId, deleted},
    'project deleted: purged managed repository',
  );
}
