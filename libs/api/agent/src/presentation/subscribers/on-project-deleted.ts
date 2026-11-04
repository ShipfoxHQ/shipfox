import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {purgeProject} from '#core/purge-project.js';

/**
 * Stops the project's active turns, then deletes its conversations and sessions. A turn stops on
 * its own at its next check, and its conversation is deleted on a later delivery, so the event is
 * redelivered until none remains. If the outbox gives up first, the purge sweeper finishes it.
 */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  const {purged} = await purgeProject({
    workspaceId: event.workspaceId,
    projectId: event.projectId,
  });
  if (!purged) {
    throw new Error(`Conversations of a deleted project are still stopping: ${event.projectId}`);
  }
}
