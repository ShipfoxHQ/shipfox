import type {WorkflowRunJobExecutionDetailDto} from '@shipfox/api-workflows-dto';
import {type Duration, intervalToDuration} from 'date-fns';
import {type Step, toStep} from './step.js';

export type JobExecutionStatus = WorkflowRunJobExecutionDetailDto['status'];
export type JobExecutionTime =
  | {state: 'fixed'; elapsed: Duration}
  | {state: 'live'; fromIso: string};
export type JobExecutionDisplayDuration =
  | ({kind: 'queue'} & JobExecutionTime)
  | ({kind: 'run'} & JobExecutionTime);

interface JobExecutionFields {
  id: string;
  jobId: string;
  sequence: number;
  name: string;
  status: JobExecutionStatus;
  statusReason: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  timedOutAt: string | null;
  createdAt: string;
  updatedAt: string;
  steps: Step[];
}

export class JobExecution {
  id!: string;
  jobId!: string;
  sequence!: number;
  name!: string;
  status!: JobExecutionStatus;
  statusReason!: string | null;
  queuedAt!: string | null;
  startedAt!: string | null;
  finishedAt!: string | null;
  timedOutAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
  steps!: Step[];

  constructor(fields: JobExecutionFields) {
    Object.assign(this, fields);
  }

  get queueTime(): JobExecutionTime | null {
    return jobExecutionQueueTimeFromTimestamps(this);
  }

  get runTime(): JobExecutionTime | null {
    return jobExecutionRunTimeFromTimestamps(this);
  }

  get displayDuration(): JobExecutionDisplayDuration | null {
    return jobExecutionDisplayDurationFromTimestamps(this);
  }
}

export function toJobExecution(dto: WorkflowRunJobExecutionDetailDto): JobExecution {
  return new JobExecution({
    id: dto.id,
    jobId: dto.job_id,
    sequence: dto.sequence,
    name: dto.name,
    status: dto.status,
    statusReason: dto.status_reason,
    queuedAt: dto.queued_at ?? null,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
    timedOutAt: dto.timed_out_at ?? null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    steps: dto.steps.map((step) => toStep(step, dto.job_id)),
  });
}

export function jobExecutionQueueTimeFromTimestamps({
  queuedAt,
  startedAt,
  finishedAt,
}: {
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}): JobExecutionTime | null {
  if (queuedAt === null) return null;
  if (finishedAt !== null && startedAt === null) return null;
  if (startedAt === null) return {state: 'live', fromIso: queuedAt};

  const elapsed = durationBetween(queuedAt, startedAt);
  return elapsed === null ? null : {state: 'fixed', elapsed};
}

export function jobExecutionRunTimeFromTimestamps({
  startedAt,
  finishedAt,
}: {
  startedAt: string | null;
  finishedAt: string | null;
}): JobExecutionTime | null {
  if (startedAt === null) return null;
  if (finishedAt === null) return {state: 'live', fromIso: startedAt};

  const elapsed = durationBetween(startedAt, finishedAt);
  return elapsed === null ? null : {state: 'fixed', elapsed};
}

export function jobExecutionDisplayDurationFromTimestamps(timestamps: {
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}): JobExecutionDisplayDuration | null {
  const runTime = jobExecutionRunTimeFromTimestamps(timestamps);
  if (runTime !== null) return {kind: 'run', ...runTime};

  const queueTime = jobExecutionQueueTimeFromTimestamps(timestamps);
  if (queueTime !== null) return {kind: 'queue', ...queueTime};

  return null;
}

function durationBetween(from: string, to: string): Duration | null {
  const start = new Date(from);
  const end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;

  return intervalToDuration({
    start,
    end: end < start ? start : end,
  });
}
