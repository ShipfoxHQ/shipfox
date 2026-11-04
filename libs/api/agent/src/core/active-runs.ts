import {logger} from '@shipfox/node-opentelemetry';
import {listActiveRunLinks, listDeliveredRunAttempts} from '#db/run-links.js';
import {type RunDeliveryWorkflows, readRunDelivery} from './deliver-run-results.js';

export interface ActiveRun {
  workflowRunId: string;
  runNumber: number;
  /** What the run is called, which is the workflow's name unless it set a run name. */
  name: string;
  attempt: number;
  status: string;
  startedAt: string | null;
  jobsFinished: number;
  jobsTotal: number;
}

type RunOverview = NonNullable<Awaited<ReturnType<RunDeliveryWorkflows['getWorkflowRunOverview']>>>;

const FINISHED_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'skipped']);

/** A large run lists no jobs, but its counts cover every one. */
function jobProgress(jobs: RunOverview['jobs']): {finished: number; total: number} {
  if (jobs.kind === 'complete') {
    const finished = jobs.items.filter((job) => FINISHED_JOB_STATUSES.has(job.status)).length;
    return {finished, total: jobs.total};
  }
  const finished = jobs.status_counts
    .filter((entry) => FINISHED_JOB_STATUSES.has(entry.status))
    .reduce((sum, entry) => sum + entry.count, 0);
  return {finished, total: jobs.total};
}

/**
 * Runs the conversation started whose latest attempt has no result yet. A run whose attempt
 * settled or ended leaves at once, even before its result lands, so the chat never shows a
 * finished run as running. A run Workflows can't read is left out, and the read still succeeds.
 */
export async function listActiveRuns(params: {
  workspaceId: string;
  conversationId: string;
  workflows: RunDeliveryWorkflows;
}): Promise<ActiveRun[]> {
  const {workspaceId, conversationId, workflows} = params;
  const workflowRunIds = await listActiveRunLinks(conversationId);
  const overviews = await Promise.all(
    workflowRunIds.map(async (workflowRunId) => {
      try {
        return await workflows.getWorkflowRunOverview({workspaceId, workflowRunId});
      } catch (error) {
        logger().warn({err: error, conversationId, workflowRunId}, 'Failed to read an active run');
        return null;
      }
    }),
  );
  const running = overviews.filter(
    (overview): overview is NonNullable<typeof overview> =>
      overview !== null && readRunDelivery(overview) === undefined,
  );
  // A link no check has seen since its attempt delivered still reads as active in the database.
  const delivered = await listDeliveredRunAttempts({
    conversationId,
    runAttemptIds: running.map((overview) => overview.attempt.id),
  });
  return running
    .filter((overview) => !delivered.has(overview.attempt.id))
    .map((overview) => {
      const progress = jobProgress(overview.jobs);
      return {
        workflowRunId: overview.run.id,
        runNumber: overview.run.number,
        name: overview.run.name,
        attempt: overview.attempt.attempt,
        status: overview.attempt.status,
        startedAt: overview.attempt.started_at,
        jobsFinished: progress.finished,
        jobsTotal: progress.total,
      };
    });
}
