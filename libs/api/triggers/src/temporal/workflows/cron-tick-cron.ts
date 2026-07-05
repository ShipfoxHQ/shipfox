import {log, proxyActivities} from '@temporalio/workflow';
import type {createTriggersCronActivities} from '../activities/index.js';

const {drainCronBatchActivity, readCronFanoutActivity} = proxyActivities<
  ReturnType<typeof createTriggersCronActivities>
>({
  // Throughput is governed by fanout and claim batch, not a per-tick time budget, so
  // give the batch drain plenty of room.
  startToCloseTimeout: '5 minutes',
  // No activity retry: the drain is not batch-idempotent across retries. A retry after a
  // committed advance would claim a fresh due batch and fire beyond the
  // fanout * TRIGGER_CRON_CLAIM_BATCH per-tick ceiling. Whole-activity failures roll the
  // batch back (rows stay due) and the once-per-minute cron schedule is the retry.
  retry: {maximumAttempts: 1},
});

/**
 * Fires once a minute (Temporal never overlaps a cron workflow with itself, so a slow
 * tick delays the next rather than doubling it). Reads the current fanout and runs that
 * many drain activities; Temporal spreads them across the worker fleet, and `SKIP LOCKED`
 * keeps their claims disjoint. The per-tick fire ceiling is
 * `fanout * TRIGGER_CRON_CLAIM_BATCH`.
 */
export async function cronTickCron(): Promise<void> {
  const fanout = await readCronFanoutActivity();
  const parallelism = Number.isInteger(fanout) && fanout > 0 ? fanout : 1;

  const summaries = await Promise.all(
    Array.from({length: parallelism}, () => drainCronBatchActivity()),
  );

  const fired = summaries.reduce((total, summary) => total + summary.fired, 0);
  const errored = summaries.reduce((total, summary) => total + summary.errored, 0);
  const retried = summaries.reduce((total, summary) => total + summary.retried, 0);

  if (fired > 0 || errored > 0 || retried > 0) {
    log.info('Cron tick drained schedules', {fired, errored, retried});
  }
}
