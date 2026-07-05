import {logger} from '@shipfox/node-opentelemetry';
import {advanceCronSchedule, claimDueCronSchedules, selectDbNow} from '#db/cron-schedules.js';
import {db} from '#db/db.js';
import {computeNextFireAt} from './compute-next-fire-at.js';
import {fireCronSubscription} from './fire-cron.js';

export interface DrainDueCronSchedulesParams {
  readonly batchSize: number;
  readonly jitterWindowSeconds: number;
  /**
   * Liveness signal invoked once per processed schedule (e.g. the Temporal activity
   * heartbeat), so a batch stuck on a slow `runWorkflow` is visible rather than
   * looking hung until the start-to-close timeout fires.
   */
  readonly onScheduleProcessed?: (() => void) | undefined;
}

export interface CronDrainSummary {
  readonly claimed: number;
  readonly fired: number;
  readonly errored: number;
  readonly retried: number;
}

/**
 * Claims one bounded batch of due cron schedules and, per row, advances the schedule
 * and fires the workflow. There is no internal drain loop, so the per-activity ceiling
 * stays a hard `batchSize`.
 *
 * The batch is claimed and processed inside a single transaction, so its `FOR UPDATE
 * SKIP LOCKED` locks are held until commit and concurrent activities/pods claim disjoint
 * rows. Each row runs in a nested savepoint that advances `next_fire_at` before firing:
 * on a transient failure the savepoint rolls back only that row's advance, leaving it due
 * for retry, without blocking the rest of the batch. Firing before the advance commits
 * makes a crash between the two re-fire the (idempotent) occurrence rather than skip it.
 */
export async function drainDueCronSchedules(
  params: DrainDueCronSchedulesParams,
): Promise<CronDrainSummary> {
  let claimed = 0;
  let fired = 0;
  let errored = 0;
  let retried = 0;

  await db().transaction(async (tx) => {
    // One database-clock reading shared by the due check and every advance, so the two
    // never disagree under application/database clock skew.
    const now = await selectDbNow(tx);
    const due = await claimDueCronSchedules({tx, limit: params.batchSize, now});
    claimed = due.length;

    for (const schedule of due) {
      const scheduledSlot = schedule.nextFireAt;
      try {
        const result = await tx.transaction(async (rowTx) => {
          const nextFireAt = computeNextFireAt({
            cronExpression: schedule.cronExpression,
            timezone: schedule.timezone,
            from: now,
            subscriptionId: schedule.subscriptionId,
            jitterWindowSeconds: params.jitterWindowSeconds,
          });
          await advanceCronSchedule({
            tx: rowTx,
            subscriptionId: schedule.subscriptionId,
            nextFireAt,
            lastFiredAt: scheduledSlot,
          });
          return await fireCronSubscription({
            subscriptionId: schedule.subscriptionId,
            scheduledSlot,
          });
        });
        if (result.outcome === 'fired') fired += 1;
        else errored += 1;
      } catch (error) {
        // Transient failure: the savepoint rolled back the advance, so the schedule
        // stays due and the next tick (or an activity retry) re-claims it.
        retried += 1;
        logger().warn(
          {err: error, subscriptionId: schedule.subscriptionId},
          'cron drain: transient fire failure; schedule left due for retry',
        );
      }
      params.onScheduleProcessed?.();
    }
  });

  return {claimed, fired, errored, retried};
}
