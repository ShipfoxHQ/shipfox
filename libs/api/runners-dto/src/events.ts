export const RUNNER_JOB_LEASE_EXPIRED = 'runners.job.lease_expired' as const;
export const RUNNER_JOB_QUEUED = 'runners.job.queued' as const;
export const RUNNER_JOB_CLAIMED = 'runners.job.claimed' as const;

export interface RunnerJobLeaseExpiredEvent {
  jobId: string;
  runId: string;
}

export interface RunnerJobQueuedEvent {
  jobId: string;
  runId: string;
  /**
   * ISO 8601 timestamp from `runners_pending_jobs.created_at`, not the outbox drain time.
   */
  queuedAt: string;
}

export interface RunnerJobClaimedEvent {
  jobId: string;
  runId: string;
  /**
   * ISO 8601 timestamp of the runner's claim (`runners_running_jobs.started_at`), not the
   * outbox drain time.
   */
  claimedAt: string;
}

export interface RunnersEventMap {
  [RUNNER_JOB_LEASE_EXPIRED]: RunnerJobLeaseExpiredEvent;
  [RUNNER_JOB_QUEUED]: RunnerJobQueuedEvent;
  [RUNNER_JOB_CLAIMED]: RunnerJobClaimedEvent;
}
