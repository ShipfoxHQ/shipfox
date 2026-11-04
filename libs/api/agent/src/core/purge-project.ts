import {
  deleteProjectConversations,
  listProjectSessions,
  markProjectAgentPurged,
  recordProjectAgentDeleted,
} from '#db/index.js';
import {deleteSessionWithObjects} from './session-retention.js';
import {stopWork} from './stop-work.js';

const SESSION_PAGE_SIZE = 100;

/**
 * Blocks later writes for a deleted project, stops its running turns, and deletes its
 * conversations and sessions. A conversation whose turn is still stopping stays, so the call
 * answers `purged: false` and the caller repeats it. Every step is safe to repeat.
 */
export async function purgeProject(params: {
  workspaceId: string;
  projectId: string;
}): Promise<{purged: boolean}> {
  const {workspaceId, projectId} = params;
  await recordProjectAgentDeleted({workspaceId, projectId});
  await stopWork({scope: {workspaceId, projectId}, reason: 'project_deleted'});

  await deleteProjectConversations({projectId});
  let page = await listProjectSessions({projectId, limit: SESSION_PAGE_SIZE});
  while (page.length > 0) {
    for (const session of page) await deleteSessionWithObjects(session);
    page = await listProjectSessions({projectId, limit: SESSION_PAGE_SIZE});
  }

  return {purged: await markProjectAgentPurged({workspaceId, projectId})};
}
