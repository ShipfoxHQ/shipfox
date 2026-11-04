import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {purgeDeletedProject} from '#core/purge-project.js';

/** Deletes the project's log streams and their stored objects. */
export async function onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
  await purgeDeletedProject({workspaceId: event.workspaceId, projectId: event.projectId});
}
