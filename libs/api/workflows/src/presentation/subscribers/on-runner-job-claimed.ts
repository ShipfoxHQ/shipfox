import type {RunnerJobClaimedEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {recordJobStartedAt} from '#db/index.js';

// Anticorruption layer: the runner reports a `claimed` fact in its own lease-broker
// language; the run lifecycle treats the claim as the job's start, so we project it onto
// `started_at`. Use the runner-owned claim timestamp, not subscriber time; the DB
// projection is first-write-wins so outbox replay cannot move the run boundary.
export async function onRunnerJobClaimed(payload: RunnerJobClaimedEvent): Promise<void> {
  logger().debug(
    {jobId: payload.jobId, runId: payload.runId},
    'Recording job started_at from claim',
  );
  await recordJobStartedAt({jobId: payload.jobId, startedAt: new Date(payload.claimedAt)});
}
