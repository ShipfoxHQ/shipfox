import type {
  EvaluationTraceRowEntryDto,
  JobListeningDto,
  JobModeDto,
  JobStatusDto,
  JobStatusReasonDto,
  ListenerStatusDto,
  ResolutionReasonDto,
  WorkflowRunJobDetailDto,
} from '@shipfox/api-workflows-dto';
import {
  type JobExecution,
  type JobExecutionDisplayDuration,
  toJobExecution,
} from './job-execution.js';

export type JobStatus = JobStatusDto;
export type JobMode = JobModeDto;
export type ListenerStatus = ListenerStatusDto;
export type ResolutionReason = ResolutionReasonDto;
export type JobStatusReason = JobStatusReasonDto;

export type JobDisplayDuration = JobExecutionDisplayDuration;

export const WORKFLOW_JOB_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const satisfies readonly JobStatus[];

export const TERMINAL_WORKFLOW_JOB_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const satisfies readonly JobStatus[];

const TERMINAL_JOB_STATUS_SET = new Set<JobStatus>(TERMINAL_WORKFLOW_JOB_STATUSES);

interface JobFields {
  id: string;
  runAttemptId: string;
  key: string;
  name: string | null;
  mode: JobMode;
  status: JobStatus;
  statusReason: JobStatusReason | null;
  evaluationTrace: EvaluationTraceRowEntryDto[] | null;
  carriedOver: boolean;
  listening: JobListeningDto | null;
  listenerStatus: ListenerStatus;
  resolutionReason: ResolutionReason | null;
  dependencies: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  jobExecutions: JobExecution[];
}

export class Job {
  id!: string;
  runAttemptId!: string;
  key!: string;
  name!: string | null;
  mode!: JobMode;
  status!: JobStatus;
  statusReason!: JobStatusReason | null;
  evaluationTrace!: EvaluationTraceRowEntryDto[] | null;
  carriedOver!: boolean;
  listening!: JobListeningDto | null;
  listenerStatus!: ListenerStatus;
  resolutionReason!: ResolutionReason | null;
  dependencies!: string[];
  position!: number;
  createdAt!: string;
  updatedAt!: string;
  jobExecutions!: JobExecution[];

  constructor(fields: JobFields) {
    Object.assign(this, fields);
  }

  get displayName(): string {
    return this.name || this.key;
  }

  get displayDuration(): JobDisplayDuration | null {
    if (this.mode === 'listening') return null;
    if (this.jobExecutions.length !== 1) return null;
    return this.jobExecutions[0]?.displayDuration ?? null;
  }

  get executionCountVisible(): boolean {
    return (
      this.jobExecutions.length > 0 && (this.mode === 'listening' || this.jobExecutions.length > 1)
    );
  }
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUS_SET.has(status);
}

export function resolveJobExecution(
  job: Job,
  jobExecutionId: string | undefined,
): JobExecution | undefined {
  const selectedExecution = jobExecutionId
    ? job.jobExecutions.find((jobExecution) => jobExecution.id === jobExecutionId)
    : undefined;
  if (selectedExecution) return selectedExecution;

  return defaultJobExecution(job);
}

export function defaultJobExecution(job: Job): JobExecution | undefined {
  const runningExecution = job.jobExecutions.find(
    (jobExecution) => jobExecution.status === 'running',
  );
  if (runningExecution) return runningExecution;

  return job.jobExecutions.reduce<JobExecution | undefined>((latest, jobExecution) => {
    if (!latest) return jobExecution;
    return jobExecution.sequence > latest.sequence ? jobExecution : latest;
  }, undefined);
}

export function toJob(dto: WorkflowRunJobDetailDto): Job {
  const jobExecutions = dto.job_executions.map(toJobExecution);

  return new Job({
    id: dto.id,
    runAttemptId: dto.run_attempt_id,
    key: dto.key,
    name: dto.name,
    mode: dto.mode,
    status: dto.status,
    statusReason: dto.status_reason,
    evaluationTrace: dto.evaluation_trace,
    carriedOver: dto.carried_over,
    listening: dto.listening,
    listenerStatus: dto.listener_status,
    resolutionReason: dto.resolution_reason,
    dependencies: dto.dependencies,
    position: dto.position,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    jobExecutions,
  });
}
