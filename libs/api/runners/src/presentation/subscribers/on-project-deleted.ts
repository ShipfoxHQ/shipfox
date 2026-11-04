import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {purgeDeletedProject} from '#core/purge-project.js';

/**
 * Deletes the project's pending jobs. A running job ends through its run's cancellation, so the
 * event fails and the outbox retries it, up to its attempt limit. The pending jobs are gone and
 * the deletion marker still blocks new ones, but `purged_at` stays unset if a job outlives the
 * retries.
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
