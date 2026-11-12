import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {
  deleteExpiredEphemeralRegistrationTokens,
  deleteExpiredJobExecutionTombstones,
  deleteExpiredRunnerReservations,
  deleteExpiredRunnerSessions,
  detectAndExpireStuckJobs,
  reapStaleRunnerInstances,
  recoverStaleIdleRunnerSessions,
} from '#core/maintenance.js';
import {STUCK_JOB_THRESHOLD_SECONDS} from '#core/maintenance-policy.js';
import {purgeUnfinishedDeletedProjects} from '#core/purge-project.js';
import {reconcileCapacityHolds} from '#db/capacity-holds.js';
import type {InstallationPlacementPolicy} from '#installation-provisioning.js';
import {
  recordCapacityHoldReconciliation,
  recordCapacityHoldReleaseLag,
  recordCapacityHoldSweep,
} from '#metrics/instance.js';

export function detectAndExpireStuckJobsActivity(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  return detectAndExpireStuckJobs(params);
}

export function deleteExpiredJobExecutionTombstonesActivity(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  return deleteExpiredJobExecutionTombstones(params);
}

export function deleteExpiredReservationsActivity(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  return deleteExpiredRunnerReservations(params);
}

export function reapStaleRunnerInstancesActivity(params?: {
  thresholdSeconds: number;
  limit: number;
}): Promise<{reaped: number; reservationsReleased: number}> {
  return reapStaleRunnerInstances(params);
}

export function recoverStaleIdleRunnerSessionsActivity(params?: {
  limit?: number;
}): Promise<{recovered: number}> {
  return recoverStaleIdleRunnerSessions(params);
}

export function deleteExpiredRunnerSessionsActivity(params?: {
  manualRetentionDays?: number;
  ephemeralRetentionDays?: number;
  limit?: number;
}): Promise<{deleted: number}> {
  return deleteExpiredRunnerSessions(params);
}

export function deleteExpiredEphemeralRegistrationTokensActivity(params?: {
  retentionDays?: number;
  limit?: number;
}): Promise<{deleted: number}> {
  return deleteExpiredEphemeralRegistrationTokens(params);
}

export async function reconcileCapacityHoldsActivity(params: {
  placement?: InstallationPlacementPolicy;
}): Promise<{reconciled: number; swept: number}> {
  const result = await reconcileCapacityHolds({
    ...params,
    onReleased: (createdAt) =>
      recordCapacityHoldReleaseLag(Math.max(0, (Date.now() - createdAt.getTime()) / 1000)),
  });
  recordCapacityHoldReconciliation(result.reconciled);
  recordCapacityHoldSweep(result.swept);
  return result;
}

/**
 * Runs every runner maintenance step in one activity. Temporal bills each activity, and
 * the detector fires every minute, so one activity instead of eight is most of our
 * Temporal usage. The GC steps are best effort: a failure is logged and the sweep moves
 * on. A failure in a later step fails the activity, and the next minute's run retries
 * the whole sweep, which is safe because every step is idempotent.
 */
export async function runMaintenanceSweepActivity(params: {
  placement?: InstallationPlacementPolicy;
}): Promise<void> {
  await deleteExpiredRows();
  await recoverStuckWork(params);
}

async function deleteExpiredRows(): Promise<void> {
  await runBestEffort('delete expired runner reservations', async () => {
    const {deleted} = await deleteExpiredRunnerReservations();
    if (deleted > 0) logger().info({deleted}, 'Deleted expired runner reservations');
  });
  await runBestEffort('delete expired job execution tombstones', async () => {
    const {deleted} = await deleteExpiredJobExecutionTombstones();
    if (deleted > 0) logger().info({deleted}, 'Deleted expired job execution tombstones');
  });
  await runBestEffort('delete expired runner sessions', async () => {
    const {deleted} = await deleteExpiredRunnerSessions();
    if (deleted > 0) logger().info({deleted}, 'Deleted expired runner sessions');
  });
  await runBestEffort('delete expired ephemeral registration tokens', async () => {
    const {deleted} = await deleteExpiredEphemeralRegistrationTokens();
    if (deleted > 0) logger().info({deleted}, 'Deleted expired ephemeral registration tokens');
  });
  await runBestEffort('finish purges of deleted projects', async () => {
    try {
      const {purged} = await purgeUnfinishedDeletedProjects();
      if (purged > 0) logger().info({purged}, 'Finished purges of deleted projects');
    } catch (error) {
      reportError(error, {boundary: 'runners.maintenance', operation: 'purge-deleted-projects'});
      throw error;
    }
  });
}

async function recoverStuckWork(params: {placement?: InstallationPlacementPolicy}): Promise<void> {
  const {expired} = await detectAndExpireStuckJobs({
    thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
  });
  if (expired > 0) {
    logger().info(
      {expired, thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS},
      'Expired stuck job leases',
    );
  }

  const {recovered} = await recoverStaleIdleRunnerSessions();
  if (recovered > 0) logger().info({recovered}, 'Recovered stale idle runner sessions');

  const {reconciled, swept} = await reconcileCapacityHoldsActivity(params);
  if (reconciled > 0 || swept > 0) logger().info({reconciled, swept}, 'Reconciled capacity holds');

  const {reaped, reservationsReleased} = await reapStaleRunnerInstances();
  if (reaped > 0) {
    logger().info({reaped, reservationsReleased}, 'Reaped stale provisioned runners');
  }
}

async function runBestEffort(step: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    logger().warn({err: error, step}, 'Runner maintenance step failed');
  }
}
