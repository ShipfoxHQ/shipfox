import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {stopWork} from '#core/stop-work.js';

/**
 * Cancels the project's open runs. A run that can't be canceled stays open, so the event is
 * redelivered until none remains.
 */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  const {remaining} = await stopWork({
    scope: {workspaceId: event.workspaceId, projectId: event.projectId},
    reason: 'project_deleted',
  });
  if (remaining > 0) {
    throw new Error(`Runs of a deleted project are still open: ${event.projectId}`);
  }
}
