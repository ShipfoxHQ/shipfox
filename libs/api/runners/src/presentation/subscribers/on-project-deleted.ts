import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {purgeDeletedProject} from '#core/purge-project.js';

/**
 * Deletes the project's pending jobs. A running job ends through its run's cancellation, so the
 * event is redelivered until none remains.
 */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  const {remaining} = await purgeDeletedProject({
    workspaceId: event.workspaceId,
    projectId: event.projectId,
  });
  if (remaining > 0) {
    throw new Error(`Jobs of a deleted project are still running: ${event.projectId}`);
  }
}
