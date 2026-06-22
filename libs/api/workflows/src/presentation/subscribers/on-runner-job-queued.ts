import type {RunnerJobQueuedEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {recordJobQueuedAt} from '#db/index.js';

// Anticorruption layer for the runner's `queued` fact. Here the two contexts happen to
// share the word, so this is an identity mapping (unlike claimed → started_at). Use the
// runner-owned queue timestamp, not subscriber time; the DB projection is first-write-wins
// so outbox replay cannot move the queue boundary.
export async function onRunnerJobQueued(payload: RunnerJobQueuedEvent): Promise<void> {
  logger().debug({jobId: payload.jobId, runId: payload.runId}, 'Recording job queued_at');
  await recordJobQueuedAt({jobId: payload.jobId, queuedAt: new Date(payload.queuedAt)});
}
