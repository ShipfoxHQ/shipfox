import type {JobStatus, JobStatusReason} from './job.js';

export type JobExecutionStatus = Exclude<JobStatus, 'skipped'>;

export interface WorkflowExecutionEvent {
  source: string;
  event: string;
  delivery_id: string;
  received_at: string;
  data: unknown;
}

export interface JobExecution {
  id: string;
  jobId: string;
  sequence: number;
  name: string;
  runner: string[] | null;
  status: JobExecutionStatus;
  statusReason: JobStatusReason | null;
  triggerEvents: WorkflowExecutionEvent[];
  outputs: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  timedOutAt: Date | null;
}
