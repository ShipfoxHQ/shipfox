export type JobStatus =
  | 'pending'
  | 'waiting_for_dependencies'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'awaiting_manual';

export interface Job {
  id: string;
  runId: string;
  name: string;
  status: JobStatus;
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

export type TerminalJobStatus = Extract<JobStatus, 'succeeded' | 'failed' | 'cancelled'>;

const TERMINAL_JOB_STATUSES = new Set<JobStatus>(['succeeded', 'failed', 'cancelled']);

export function isJobTerminal(status: JobStatus): status is TerminalJobStatus {
  return TERMINAL_JOB_STATUSES.has(status);
}
