import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  markProjectPurgedIfEmpty,
  purgeProjectRows,
  recordProjectDeleted,
} from '#db/purge-project.js';

/**
 * Blocks later writes for the deleted project, then deletes its subscriptions, agent
 * subscriptions, listener subscriptions, and decisions. Every step is safe to repeat, because the
 * outbox redelivers. It throws while a row remains, so the event is redelivered until none does.
 */
export async function onProjectDeleted(payload: ProjectDeletedEvent): Promise<void> {
  const scope = {workspaceId: payload.workspaceId, projectId: payload.projectId};
  await recordProjectDeleted(scope);
  const purged = await purgeProjectRows(payload.projectId);
  const complete = await markProjectPurgedIfEmpty(scope);
  logger().info({...scope, ...purged, complete}, 'project deleted: purged triggers rows');
  if (!complete) {
    throw new Error(`Triggers rows of a deleted project remain: ${payload.projectId}`);
  }
}
