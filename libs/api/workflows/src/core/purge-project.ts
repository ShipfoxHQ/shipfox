import {reportError} from '@shipfox/node-error-monitoring';
import type {ModuleService} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {
  countProjectWorkflowRuns,
  deleteTerminalWorkflowRuns,
  listUnpurgedProjectScopes,
  markProjectPurged,
  recordProjectDeleted,
} from '#db/deleted-scopes.js';
import {stopWork} from './stop-work.js';

const UNPURGED_PROJECTS_PER_SWEEP = 100;
const SWEEP_INTERVAL_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Blocks later writes for a deleted project, stops its open runs, then deletes its finished runs
 * with their children. A run that is still open stays, and the next pass deletes it. Returns
 * how many runs remain, and marks the project purged once none does.
 */
export async function purgeDeletedProject(params: {
  workspaceId: string;
  projectId: string;
}): Promise<{remaining: number}> {
  const scope = {workspaceId: params.workspaceId, projectId: params.projectId};
  await recordProjectDeleted(scope, 'project_deleted');
  await stopWork({scope, reason: 'project_deleted'});
  await deleteTerminalWorkflowRuns(scope);

  const remaining = await countProjectWorkflowRuns(scope);
  if (remaining === 0) await markProjectPurged(scope);
  return {remaining};
}

/**
 * Runs the purge again for every deleted project that never finished it, such as one whose event
 * was dead-lettered while a run was still stopping. A failure in one project does not stop the
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
      const {remaining} = await purgeDeletedProject(scope);
      if (remaining === 0) purged += 1;
    } catch (error) {
      logger().error({err: error, ...scope}, 'Failed to purge a deleted project');
      reportError(error, {
        boundary: 'workflows.maintenance',
        operation: 'purge-deleted-project',
        extra: {workspaceId: scope.workspaceId, projectId: scope.projectId},
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
              boundary: 'workflows.maintenance',
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
