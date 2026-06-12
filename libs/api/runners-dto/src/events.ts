export const RUNNER_JOB_LEASE_EXPIRED = 'runners.job.lease_expired' as const;

export interface RunnerJobLeaseExpiredEvent {
  jobId: string;
  runId: string;
}

export interface RunnersEventMap {
  [RUNNER_JOB_LEASE_EXPIRED]: RunnerJobLeaseExpiredEvent;
}
