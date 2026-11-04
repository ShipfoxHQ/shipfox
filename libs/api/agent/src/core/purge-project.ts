import {reportError} from '@shipfox/node-error-monitoring';
import type {ModuleService} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {
  deleteProjectConversations,
  listProjectSessions,
  listUnpurgedProjectScopes,
  markProjectAgentPurged,
  recordProjectAgentDeleted,
} from '#db/index.js';
import {deleteSessionWithObjects} from './session-retention.js';
import {stopWork} from './stop-work.js';

const SESSION_PAGE_SIZE = 100;
const UNPURGED_PROJECTS_PER_SWEEP = 100;
const SWEEP_INTERVAL_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

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

/**
 * Runs the purge again for every deleted project that never finished it, such as one whose event
 * was dead-lettered while a turn was still stopping. A failure in one project does not stop the
 * others, and an aborted signal stops the pass before the next project. Returns how many projects
 * it finished.
 */
export async function purgeUnfinishedDeletedProjects(
  signal?: AbortSignal,
): Promise<{purged: number}> {
  const scopes = await listUnpurgedProjectScopes(UNPURGED_PROJECTS_PER_SWEEP);
  let purged = 0;
  for (const scope of scopes) {
    if (signal?.aborted) break;
    try {
      const result = await purgeProject(scope);
      if (result.purged) purged += 1;
    } catch (error) {
      logger().error({err: error, ...scope}, 'Failed to purge a deleted project');
      reportError(error, {
        boundary: 'agent.maintenance',
        operation: 'purge-deleted-project',
        extra: scope,
      });
    }
  }
  return {purged};
}

/** Finishes the purges the `PROJECT_DELETED` event left behind, once a minute. */
export function createDeletedProjectPurgeSweeper(
  options: {intervalMs?: number} = {},
): ModuleService {
  const intervalMs = options.intervalMs ?? SWEEP_INTERVAL_MS;
  return {
    name: 'deleted-project-purge-sweeper',
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    start: () => {
      const controller = new AbortController();
      let wake: (() => void) | undefined;
      const finished = (async () => {
        while (!controller.signal.aborted) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, intervalMs);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          if (controller.signal.aborted) return;
          try {
            const {purged} = await purgeUnfinishedDeletedProjects(controller.signal);
            if (purged > 0) logger().info({purged}, 'Finished purges of deleted projects');
          } catch (error) {
            logger().error({err: error}, 'Deleted project purge sweep failed');
            reportError(error, {
              boundary: 'agent.maintenance',
              operation: 'purge-deleted-projects',
            });
          }
        }
      })();
      return Promise.resolve({
        stop: async () => {
          controller.abort();
          wake?.();
          await finished;
        },
        finished,
      });
    },
  };
}
