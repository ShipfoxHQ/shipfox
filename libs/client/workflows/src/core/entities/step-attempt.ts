import type {
  StepAttemptDto,
  StepGateResultDto,
  StepRestartResultDto,
} from '@shipfox/api-workflows-dto';

export type StepGateResult = StepGateResultDto;
export type StepRestartResult = StepRestartResultDto;

export interface StepAttempt {
  id: string;
  stepId: string;
  jobId: string;
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

export function toStepAttempt(
  dto: StepAttemptDto,
  jobId: string,
  jobExecutionId: string,
): StepAttempt {
  return {
    id: dto.id,
    stepId: dto.step_id,
    jobId,
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
  };
}
