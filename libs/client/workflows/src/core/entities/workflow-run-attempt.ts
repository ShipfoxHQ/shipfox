import {type Duration, intervalToDuration} from 'date-fns';
import type {WorkflowRunStatus} from './workflow-run.js';

export type WorkflowRunAttemptDisplayDuration =
  | {state: 'fixed'; elapsed: Duration}
  | {state: 'live'; fromIso: string};

interface WorkflowRunAttemptSummaryFields {
  workflowRunId: string;
  attempt: number;
  status: WorkflowRunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface WorkflowRunAttemptFields extends WorkflowRunAttemptSummaryFields {
  id: string;
  rerunMode: 'all' | 'failed' | null;
}

export class WorkflowRunAttemptSummary {
  workflowRunId!: string;
  attempt!: number;
  status!: WorkflowRunStatus;
  createdAt!: string;
  startedAt!: string | null;
  finishedAt!: string | null;

  constructor(fields: WorkflowRunAttemptSummaryFields) {
    Object.assign(this, fields);
  }

  get displayDuration(): WorkflowRunAttemptDisplayDuration | null {
    return workflowRunAttemptDisplayDurationFromTimestamps(this);
  }
}

export class WorkflowRunAttempt extends WorkflowRunAttemptSummary {
  id!: string;
  rerunMode!: 'all' | 'failed' | null;

  constructor(fields: WorkflowRunAttemptFields) {
    super(fields);
    this.id = fields.id;
    this.rerunMode = fields.rerunMode;
  }
}

export function workflowRunAttemptDisplayDurationFromTimestamps({
  startedAt,
  finishedAt,
}: {
  startedAt: string | null;
  finishedAt: string | null;
}): WorkflowRunAttemptDisplayDuration | null {
  if (startedAt === null) return null;
  if (finishedAt === null) return {state: 'live', fromIso: startedAt};

  const elapsed = durationBetween(startedAt, finishedAt);
  return elapsed === null ? null : {state: 'fixed', elapsed};
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
