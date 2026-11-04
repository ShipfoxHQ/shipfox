import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {stopWork} from '#core/stop-work.js';

/**
 * Stops the project's active turns. They stop on their own as each reaches its next check, so
 * `remaining` isn't a reason to retry, and the project's admission refuses the turns after them.
 */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  await stopWork({
    scope: {workspaceId: event.workspaceId, projectId: event.projectId},
    reason: 'project_deleted',
  });
}
