import {log, patched, proxyActivities} from '@temporalio/workflow';
import type {createTriggersCronActivities} from '../activities/index.js';

// Matches the clamp in runCronTickActivity, for runs replaying the legacy path.
const MAX_CRON_FANOUT = 32;

const {drainCronBatchActivity, readCronFanoutActivity, runCronTickActivity} = proxyActivities<
  ReturnType<typeof createTriggersCronActivities>
>({
  // Throughput is governed by fanout and claim batch, not a per-tick time budget, so
  // give the batch drain plenty of room.
  startToCloseTimeout: '5 minutes',
  // The drain heartbeats once per processed schedule, so a hung run stops heartbeating
  // well before the start-to-close timeout. Fail it within a minute (rather than after
  // five) so its FOR UPDATE SKIP LOCKED locks release and the next tick re-claims those
  // rows.
  heartbeatTimeout: '1 minute',
  // No activity retry: the drain is not batch-idempotent across retries. A retry after a
  // committed advance would claim a fresh due batch and fire beyond the
  // fanout * TRIGGER_CRON_CLAIM_BATCH per-tick ceiling. A failed drain rolls back only
  // its own batch (those rows stay due); drains that succeeded in the same tick have
  // already committed. The once-per-minute cron schedule is the retry.
  retry: {maximumAttempts: 1},
});

/**
 * Fires once a minute (Temporal never overlaps a cron workflow with itself, so a slow
 * tick delays the next rather than doubling it). One activity runs TRIGGER_CRON_FANOUT
 * drains in parallel. The per-tick fire ceiling is `fanout * TRIGGER_CRON_CLAIM_BATCH`.
 */
export async function cronTickCron(): Promise<void> {
  const {fired, errored, retried} = patched('single-cron-tick-activity')
    ? await runCronTickActivity()
    : await runLegacyCronTick();
  if (fired > 0 || errored > 0 || retried > 0) {
    log.info('Cron tick drained schedules', {fired, errored, retried});
  }
}

// Runs that started before the single-activity tick shipped replay this path.
async function runLegacyCronTick(): Promise<{fired: number; errored: number; retried: number}> {
  const fanout = await readCronFanoutActivity();
  const requested = Number.isInteger(fanout) && fanout > 0 ? fanout : 1;
  const parallelism = Math.min(requested, MAX_CRON_FANOUT);
  const summaries = await Promise.all(
    Array.from({length: parallelism}, () => drainCronBatchActivity()),
  );
  return {
    fired: summaries.reduce((total, summary) => total + summary.fired, 0),
    errored: summaries.reduce((total, summary) => total + summary.errored, 0),
    retried: summaries.reduce((total, summary) => total + summary.retried, 0),
  };
}
