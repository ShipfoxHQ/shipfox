import type {JobStatus, JobStatusReason} from './job.js';

export type JobExecutionStatus = Exclude<JobStatus, 'skipped'>;

export interface JobExecution {
  id: string;
  jobId: string;
  sequence: number;
  name: string;
  status: JobExecutionStatus;
  statusReason: JobStatusReason | null;
  triggerEvents: unknown[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  timedOutAt: Date | null;
}
