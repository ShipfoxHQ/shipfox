export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export type JobMode = 'one_shot' | 'listening';

export type ListenerStatus = 'inactive' | 'listening' | 'resolved';

export type ResolutionReason = 'until' | 'timeout' | 'max_executions' | 'cancelled';

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
  workflowRunAttemptId: string;
  name: string;
  mode: JobMode;
  nameTemplate: string | null;
  status: JobStatus;
  statusReason: JobStatusReason | null;
  carriedOver: boolean;
  success?: string | null;
  executionTimeoutMs?: number | null;
  listeningTimeoutMs: number | null;
  maxExecutions: number | null;
  onResolve: 'finish' | 'cancel' | null;
  batchDebounceMs: number | null;
  batchMaxSize: number | null;
  batchMaxWaitMs: number | null;
  listenerStatus: ListenerStatus;
  resolutionReason: ResolutionReason | null;
  listeningOn: JobListeningTrigger[] | null;
  listeningUntil: JobListeningTrigger[] | null;
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

export interface JobListeningTrigger {
  readonly source: string;
  readonly event: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly filter?: string;
}

export type TerminalJobStatus = Extract<
  JobStatus,
  'succeeded' | 'failed' | 'cancelled' | 'skipped'
>;

const TERMINAL_JOB_STATUSES = new Set<JobStatus>(['succeeded', 'failed', 'cancelled', 'skipped']);

export function isJobTerminal(status: JobStatus): status is TerminalJobStatus {
  return TERMINAL_JOB_STATUSES.has(status);
}

export function jobDurationFor(
  job: Pick<Job, 'queuedAt' | 'startedAt' | 'finishedAt'>,
): JobDuration {
  const {queuedAt, startedAt, finishedAt} = job;

  if (startedAt !== null && finishedAt !== null) {
    return {kind: 'finished', from: startedAt, to: finishedAt};
  }

  if (startedAt !== null) return {kind: 'running', from: startedAt};
  if (finishedAt === null && queuedAt !== null) return {kind: 'queued', from: queuedAt};
  return {kind: 'none'};
}

export function toJobStatusReason(value: string | null): JobStatusReason | null {
  if (value === null) return null;
  return JOB_STATUS_REASON_SET.has(value as JobStatusReason)
    ? (value as JobStatusReason)
    : 'unknown';
}
