import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {deleteIntegrationEventDedupForProject} from '#db/integration-event-dedup.js';
import {deleteProjectAccess} from '#db/project-access.js';

/**
 * Deletes the rows this module keeps for a deleted project: its access and its event dedup rows.
 * The tombstone stays, because usage reads the project's name and slug from it. Every step is
 * safe to repeat, because the outbox redelivers.
 */
export async function onProjectDeleted(payload: ProjectDeletedEvent): Promise<void> {
  const scopes = await deleteProjectAccess(payload.projectId);
  const dedupRows = await deleteIntegrationEventDedupForProject(payload.projectId);
  logger().info(
    {projectId: payload.projectId, workspaceId: payload.workspaceId, scopes, dedupRows},
    'project deleted: purged projects rows',
  );
}
