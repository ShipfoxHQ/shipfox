import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {purgeProjectCache} from '#core/purge-project-cache.js';

/** Deletes the deleted project's cache entries and their stored objects. Safe to repeat. */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  const entries = await purgeProjectCache({
    workspaceId: event.workspaceId,
    projectId: event.projectId,
  });
  logger().info(
    {projectId: event.projectId, workspaceId: event.workspaceId, entries},
    'project deleted: purged cache entries',
  );
}
