import {finalizeRunningJob, findStuckJobs} from '#db/jobs.js';
import {RunningJobNotFoundError} from './errors.js';

/**
 * Marks a running job as finished on behalf of the runner that owns it.
 * Throws `RunningJobNotFoundError` if no row matches — typical reasons are an
 * unknown jobId or a runner token that does not own the row, both of which
 * the route layer surfaces as 404.
 */
export async function completeJob(
  params: {jobId: string; runnerTokenId: string},
  result: {status: 'succeeded' | 'failed'; output?: unknown},
): Promise<{runId: string}> {
  const finalized = await finalizeRunningJob({
    jobId: params.jobId,
    runnerTokenId: params.runnerTokenId,
    status: result.status,
    output: result.output,
    onMissing: 'throw',
  });
  if (!finalized) throw new RunningJobNotFoundError(params.jobId);
  return finalized;
}

/**
 * Stuck-job detection: finds running jobs whose heartbeat is older than the
 * threshold and finalizes each as failed with `output.reason: 'runner_disappeared'`.
 *
 * Two-step on purpose:
 *   1. `findStuckJobs` reads a candidate snapshot.
 *   2. each `finalizeRunningJob` re-checks the threshold inside its DELETE,
 *      so a candidate that successfully heartbeated between the two steps
 *      survives untouched and emits no event.
 *
 * N+1 by design (~1 SELECT + N DELETEs per tick). Acceptable at v1 runner counts;
 * a bulk `DELETE … RETURNING` plus multi-row outbox insert is the documented
 * scale path.
 */
export async function detectAndFailStuckJobs(params: {
  thresholdSeconds: number;
}): Promise<{failed: number}> {
  const candidates = await findStuckJobs({thresholdSeconds: params.thresholdSeconds});

  let failed = 0;
  for (const candidate of candidates) {
    const finalized = await finalizeRunningJob({
      jobId: candidate.jobId,
      staleBeforeMs: params.thresholdSeconds * 1000,
      status: 'failed',
      output: {reason: 'runner_disappeared'},
      onMissing: 'noop',
    });
    if (finalized) failed += 1;
  }
  return {failed};
}
