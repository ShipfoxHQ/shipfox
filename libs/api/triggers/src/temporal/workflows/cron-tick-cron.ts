import {log, proxyActivities} from '@temporalio/workflow';
import type {createTriggersCronActivities} from '../activities/index.js';

// Upper bound on per-tick parallelism. A misconfigured TRIGGER_CRON_FANOUT (e.g. a
// pasted large number) is clamped to this rather than spawning an unbounded fan-out
// that could stall the tick, so one config mistake cannot stop cron firing.
const MAX_CRON_FANOUT = 32;

const {drainCronBatchActivity, readCronFanoutActivity} = proxyActivities<
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
  const requested = Number.isInteger(fanout) && fanout > 0 ? fanout : 1;
  const parallelism = Math.min(requested, MAX_CRON_FANOUT);
  if (parallelism < requested) {
    log.warn('Cron tick fanout exceeds the maximum; clamping', {
      requested,
      max: MAX_CRON_FANOUT,
    });
  }

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
