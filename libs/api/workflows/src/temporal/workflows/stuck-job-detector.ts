import {log, proxyActivities} from '@temporalio/workflow';

import type {createOrchestrationActivities} from '../activities/index.js';

const {detectAndFailStuckJobsActivity} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '60s',
});

/**
 * Cron-driven stuck-job detector. Runs once per Temporal cron tick (per workflow
 * registration with `cronSchedule`). Each invocation fails any running_jobs row
 * whose `last_heartbeat_at` is older than the threshold and emits the standard
 * `runners.job.completed` event so the orchestration advances normally.
 *
 * Threshold lives here for now; per the codex F11 follow-up it may move into the
 * runners module along with the worker.
 */
const STUCK_JOB_THRESHOLD_SECONDS = 180;

export async function stuckJobDetector(): Promise<void> {
  const {failed} = await detectAndFailStuckJobsActivity({
    thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
  });
  if (failed > 0) {
    log.info('Stuck-job detector failed jobs', {
      failed,
      thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
    });
  }
}
