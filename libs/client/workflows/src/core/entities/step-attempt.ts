import type {
  StepAttemptDto,
  StepGateResultDto,
  StepRestartResultDto,
} from '@shipfox/api-workflows-dto';
import {type Duration, intervalToDuration} from 'date-fns';

export type StepGateResult = StepGateResultDto;
export type StepRestartResult = StepRestartResultDto;
export type StepAttemptDisplayDuration =
  | {state: 'fixed'; elapsed: Duration}
  | {state: 'live'; fromIso: string};

interface StepAttemptFields {
  id: string;
  stepId: string;
  jobExecutionId: string;
  attempt: number;
  executionOrder: number;
  status: string;
  exitCode: number | null;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  gateResult: StepGateResult;
  restartReason: string | null;
  restartResult: StepRestartResult;
  startedAt: string;
  finishedAt: string | null;
}

export class StepAttempt {
  id!: string;
  stepId!: string;
  jobExecutionId!: string;
  attempt!: number;
  executionOrder!: number;
  status!: string;
  exitCode!: number | null;
  output!: Record<string, unknown> | null;
  error!: Record<string, unknown> | null;
  gateResult!: StepGateResult;
  restartReason!: string | null;
  restartResult!: StepRestartResult;
  startedAt!: string;
  finishedAt!: string | null;

  constructor(fields: StepAttemptFields) {
    Object.assign(this, fields);
  }

  get displayDuration(): StepAttemptDisplayDuration | null {
    return stepAttemptDisplayDurationFromTimestamps(this);
  }
}

export function toStepAttempt(dto: StepAttemptDto, jobExecutionId: string): StepAttempt {
  return new StepAttempt({
    id: dto.id,
    stepId: dto.step_id,
    jobExecutionId,
    attempt: dto.attempt,
    executionOrder: dto.execution_order,
    status: dto.status,
    exitCode: dto.exit_code ?? null,
    output: dto.output ?? null,
    error: dto.error ?? null,
    gateResult: dto.gate_result ?? null,
    restartReason: dto.restart_reason ?? null,
    restartResult: dto.restart_result ?? null,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at ?? null,
  });
}

export function stepAttemptDisplayDurationFromTimestamps({
  startedAt,
  finishedAt,
}: {
  startedAt: string;
  finishedAt: string | null;
}): StepAttemptDisplayDuration | null {
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
