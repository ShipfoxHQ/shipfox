import {finalizeRunningJob, findStuckJobs} from '#db/jobs.js';
import {RunningJobNotFoundError} from './errors.js';

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

// N+1 by design (~1 SELECT + N DELETEs per tick). Bulk DELETE…RETURNING +
// multi-row outbox insert is the documented scale path; deferred until load
// signals demand it.
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
