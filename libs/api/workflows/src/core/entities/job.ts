export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export type JobStatusReason =
  | 'dependency_not_completed'
  | 'condition_false'
  | 'user_cancelled'
  | 'run_cancelled'
  | 'timed_out'
  | 'runner_lost'
  | 'step_failed'
  | 'unknown';

const JOB_STATUS_REASONS = new Set<JobStatusReason>([
  'dependency_not_completed',
  'condition_false',
  'user_cancelled',
  'run_cancelled',
  'timed_out',
  'runner_lost',
  'step_failed',
  'unknown',
]);

export interface Job {
  id: string;
  runId: string;
  name: string;
  status: JobStatus;
  statusReason: JobStatusReason | null;
  dependencies: string[];
  runner: string[] | null;
  position: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  timedOutAt: Date | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export type TerminalJobStatus = Extract<
  JobStatus,
  'succeeded' | 'failed' | 'cancelled' | 'skipped'
>;

const TERMINAL_JOB_STATUSES = new Set<JobStatus>(['succeeded', 'failed', 'cancelled', 'skipped']);

export function isJobTerminal(status: JobStatus): status is TerminalJobStatus {
  return TERMINAL_JOB_STATUSES.has(status);
}

export function toJobStatusReason(value: string | null): JobStatusReason | null {
  if (value === null) return null;
  return JOB_STATUS_REASONS.has(value as JobStatusReason) ? (value as JobStatusReason) : 'unknown';
}
