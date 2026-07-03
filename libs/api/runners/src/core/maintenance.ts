import {config} from '#config.js';
import {expireStuckJobExecutions} from '#db/job-executions.js';
import {reapStaleProvisionedRunners as reapStaleProvisionedRunnersDb} from '#db/provisioned-runners.js';
import {deleteExpiredReservations} from '#db/reservations.js';
import {deleteExpiredRunnerSessions as deleteExpiredRunnerSessionsDb} from '#db/runner-sessions.js';
import {provisionedRunnerReapedCount, reservationReleasedCount} from '#metrics/instance.js';
import {STUCK_JOB_THRESHOLD_SECONDS} from './maintenance-policy.js';

export interface DetectAndExpireStuckJobsParams {
  noFirstHeartbeatGraceSeconds?: number;
  thresholdSeconds?: number;
}

export async function detectAndExpireStuckJobs(
  params: DetectAndExpireStuckJobsParams = {},
): Promise<{expired: number}> {
  const reaped = await expireStuckJobExecutions({
    noFirstHeartbeatGraceSeconds:
      params.noFirstHeartbeatGraceSeconds ?? config.RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS,
    thresholdSeconds: params.thresholdSeconds ?? STUCK_JOB_THRESHOLD_SECONDS,
  });
  return {expired: reaped.length};
}

export async function deleteExpiredRunnerReservations(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  const deleted = await deleteExpiredReservations(params);
  return {deleted};
}

export async function reapStaleProvisionedRunners(params?: {
  thresholdSeconds?: number;
  limit?: number;
}): Promise<{reaped: number; reservationsReleased: number}> {
  const result = await reapStaleProvisionedRunnersDb({
    thresholdSeconds:
      params?.thresholdSeconds ?? config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS,
    limit: params?.limit ?? config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT,
  });

  if (result.reaped > 0) provisionedRunnerReapedCount.add(result.reaped);
  if (result.reservationsReleased > 0) {
    reservationReleasedCount.add(result.reservationsReleased);
  }

  return result;
}

export async function deleteExpiredRunnerSessions(params?: {
  manualRetentionDays?: number;
  ephemeralRetentionDays?: number;
  limit?: number;
}): Promise<{deleted: number}> {
  const deleted = await deleteExpiredRunnerSessionsDb({
    manualRetentionDays: params?.manualRetentionDays ?? config.RUNNER_SESSION_MANUAL_RETENTION_DAYS,
    ephemeralRetentionDays:
      params?.ephemeralRetentionDays ?? config.RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS,
    limit: params?.limit ?? config.RUNNER_SESSION_GC_BATCH_SIZE,
  });
  return {deleted};
}
