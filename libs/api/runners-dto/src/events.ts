import type {StepResultDto} from '#schemas/complete-job.js';

export const RUNNER_JOB_COMPLETED = 'runners.job.completed' as const;

export interface RunnerJobCompletedEvent {
  jobId: string;
  runId: string;
  status: 'succeeded' | 'failed';
  steps: StepResultDto[];
}

export const RUNNER_JOB_LEASE_EXPIRED = 'runners.job.lease_expired' as const;

export interface RunnerJobLeaseExpiredEvent {
  jobId: string;
  runId: string;
}

export interface RunnersEventMap {
  [RUNNER_JOB_COMPLETED]: RunnerJobCompletedEvent;
  [RUNNER_JOB_LEASE_EXPIRED]: RunnerJobLeaseExpiredEvent;
}
