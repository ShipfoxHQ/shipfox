import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {markProjectPurged, recordProjectDeleted} from '#db/deleted-scopes.js';
import {purgeProjectRows} from '#db/purge-project.js';

/**
 * Blocks later writes for a deleted project, then deletes the rows it owns. A sync already
 * running writes nothing after the marker commits. Every step is safe to repeat, because the
 * outbox redelivers.
 */
export async function onProjectDeleted(payload: ProjectDeletedEvent): Promise<void> {
  const scope = {workspaceId: payload.workspaceId, projectId: payload.projectId};
  await recordProjectDeleted({scope, reason: 'project_deleted'});
  const purged = await purgeProjectRows(scope);
  const complete = await markProjectPurged(scope);
  logger().info({...scope, purged, complete}, 'project deleted: purged definitions rows');
  if (!complete) {
    throw new Error(`Definitions of a deleted project are still being written: ${scope.projectId}`);
  }
}
