export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export const JOB_STATUS_REASONS = [
  'dependency_not_completed',
  'condition_false',
  'user_cancelled',
  'run_cancelled',
  'timed_out',
  'runner_lost',
  'step_failed',
  'unknown',
] as const;

export type JobStatusReason = (typeof JOB_STATUS_REASONS)[number];

const JOB_STATUS_REASON_SET = new Set<JobStatusReason>(JOB_STATUS_REASONS);

export interface Job {
  id: string;
  runId: string;
  name: string;
  status: JobStatus;
  statusReason: JobStatusReason | null;
  carriedOver: boolean;
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

export type JobDuration =
  | {kind: 'none'}
  | {kind: 'queued'; from: Date}
  | {kind: 'running'; from: Date}
  | {kind: 'finished'; from: Date; to: Date};

export type TerminalJobStatus = Extract<
  JobStatus,
  'succeeded' | 'failed' | 'cancelled' | 'skipped'
>;

const TERMINAL_JOB_STATUSES = new Set<JobStatus>(['succeeded', 'failed', 'cancelled', 'skipped']);

export function isJobTerminal(status: JobStatus): status is TerminalJobStatus {
  return TERMINAL_JOB_STATUSES.has(status);
}

export function jobDurationFor(
  job: Pick<Job, 'status' | 'queuedAt' | 'startedAt' | 'finishedAt'>,
): JobDuration {
  const {status, queuedAt, startedAt, finishedAt} = job;
  const terminal = isJobTerminal(status);

  if (startedAt === null) {
    if (!terminal && queuedAt !== null) {
      return {kind: 'queued', from: queuedAt};
    }

    return {kind: 'none'};
  }

  if (finishedAt !== null) {
    return {kind: 'finished', from: startedAt, to: finishedAt};
  }

  if (terminal) {
    return {kind: 'none'};
  }

  return {kind: 'running', from: startedAt};
}

export function toJobStatusReason(value: string | null): JobStatusReason | null {
  if (value === null) return null;
  return JOB_STATUS_REASON_SET.has(value as JobStatusReason)
    ? (value as JobStatusReason)
    : 'unknown';
}
