import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {purgeDeletedProject} from '#core/purge-project.js';

/**
 * Cancels the project's open runs, then deletes its run history. A run that is still open stays,
 * so the event fails and the outbox retries it, up to its attempt limit.
 */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  const {remaining} = await purgeDeletedProject({
    workspaceId: event.workspaceId,
    projectId: event.projectId,
  });
  if (remaining > 0) {
    throw new Error(`Runs of a deleted project are still open: ${event.projectId}`);
  }
}
