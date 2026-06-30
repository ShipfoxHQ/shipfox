import type {RunnerJobClaimedEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {recordJobExecutionStartedAt} from '#db/index.js';

// Anticorruption layer: the runner reports a `claimed` fact in its own lease-broker
// language; the run lifecycle treats the claim as the job's start, so we project it onto
// `started_at`. Use the runner-owned claim timestamp, not subscriber time; the DB
// projection is first-write-wins so outbox replay cannot move the run boundary.
export async function onRunnerJobClaimed(payload: RunnerJobClaimedEvent): Promise<void> {
  logger().debug(
    {jobId: payload.jobId, executionId: payload.executionId, runId: payload.runId},
    'Recording execution started_at from claim',
  );
  await recordJobExecutionStartedAt({
    executionId: payload.executionId,
    startedAt: new Date(payload.claimedAt),
  });
}
