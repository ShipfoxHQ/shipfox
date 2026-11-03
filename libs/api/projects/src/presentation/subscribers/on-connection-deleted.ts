import type {IntegrationConnectionDeletedEvent} from '@shipfox/api-integration-core-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {deleteConnectionScopes} from '#db/project-access.js';

/**
 * Removes the deleted connection from every project's access. A project left with `selected` and
 * no scope reaches only its config source.
 */
export async function onConnectionDeleted(
  payload: IntegrationConnectionDeletedEvent,
): Promise<void> {
  const removed = await deleteConnectionScopes(payload.connectionId);
  if (removed > 0) {
    logger().info(
      {connectionId: payload.connectionId, workspaceId: payload.workspaceId, projects: removed},
      'connection deleted: removed from project access',
    );
  }
}
