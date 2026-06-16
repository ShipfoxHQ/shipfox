import {
  type StepAttemptDto,
  type StepDto,
  type StepErrorCategory,
  type StepErrorDtoShape,
  type StepGateResultDto,
  type StepRestartResultDto,
  type StepSourceLocationDto,
  stepErrorReasonSchema,
} from '@shipfox/api-workflows-dto';
import type {Step, StepAttempt} from '#core/entities/step.js';

// Domain `error` is loosely typed (jsonb), so narrow it to the fixed runner
// contract rather than trusting whatever shape the row happens to hold. `category`
// is not stored on the row; the caller derives it from the step type and passes it
// in (server-authoritative, never trusted from the runner).
function toStepErrorDto(
  error: Record<string, unknown> | null,
  category: StepErrorCategory,
): StepErrorDtoShape {
  if (error === null) return null;
  const message = typeof error.message === 'string' ? error.message : '';
  const exitCode = error.exitCode;
  const signal = typeof error.signal === 'string' ? error.signal : undefined;
  const reason = stepErrorReasonSchema.safeParse(error.reason);
  return {
    message,
    ...(exitCode === null || typeof exitCode === 'number' ? {exit_code: exitCode} : {}),
    ...(signal === undefined ? {} : {signal}),
    ...(reason.success ? {reason: reason.data} : {}),
    category,
  };
}

// Inverse of toStepErrorDto: reported wire errors land on the domain row in
// camelCase so the read path renders them back without a special case. `category`
// is intentionally NOT persisted — the server derives it from the step type on
// read, so a runner-supplied category is ignored here.
export function fromStepErrorDto(
  error: StepErrorDtoShape | undefined,
): Record<string, unknown> | null {
  if (!error) return null;
  return {
    message: error.message,
    ...(error.exit_code === null || typeof error.exit_code === 'number'
      ? {exitCode: error.exit_code}
      : {}),
    ...(typeof error.signal === 'string' ? {signal: error.signal} : {}),
    ...(error.reason === undefined ? {} : {reason: error.reason}),
  };
}

function isIntOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

function toStepGateResultDto(gateResult: Record<string, unknown> | null): StepGateResultDto {
  if (gateResult === null) return null;

  const exitCode = gateResult.exit_code;
  const passed = gateResult.passed;
  const source = gateResult.source;
  const reason = gateResult.reason;

  if (passed === true && typeof source === 'string' && isIntOrNull(exitCode)) {
    return {kind: 'passed', passed, source, exit_code: exitCode};
  }

  if (
    passed === false &&
    gateResult.uncheckable === true &&
    typeof reason === 'string' &&
    isIntOrNull(exitCode)
  ) {
    return {kind: 'uncheckable', passed, uncheckable: true, reason, exit_code: exitCode};
  }

  if (passed === false && typeof source === 'string' && isIntOrNull(exitCode)) {
    return {kind: 'failed', passed, source, exit_code: exitCode};
  }

  return {kind: 'unknown', data: gateResult};
}

function toStepRestartResultDto(restartReason: string | null): StepRestartResultDto {
  if (restartReason === null) return null;
  return {kind: 'restart_enqueued', reason: restartReason};
}

export function toStepDto(step: Step): StepDto {
  return {
    id: step.id,
    job_id: step.jobId,
    name: step.name,
    source_location: toStepSourceLocationDto(step.sourceLocation),
    status: step.status,
    type: step.type,
    config: step.config,
    error: toStepErrorDto(step.error, step.type === 'setup' ? 'setup' : 'user'),
    position: step.position,
    current_attempt: step.currentAttempt,
    created_at: step.createdAt.toISOString(),
    updated_at: step.updatedAt.toISOString(),
  };
}

function toStepSourceLocationDto(
  sourceLocation: Step['sourceLocation'],
): StepSourceLocationDto | null {
  if (sourceLocation === null) return null;
  return {
    start_line: sourceLocation.startLine,
    end_line: sourceLocation.endLine,
  };
}

export function toStepAttemptDto(attempt: StepAttempt): StepAttemptDto {
  return {
    id: attempt.id,
    step_id: attempt.stepId,
    job_id: attempt.jobId,
    attempt: attempt.attempt,
    status: attempt.status,
    exit_code: attempt.exitCode,
    output: attempt.output,
    error: attempt.error,
    gate_result: toStepGateResultDto(attempt.gateResult),
    restart_reason: attempt.restartReason,
    restart_result: toStepRestartResultDto(attempt.restartReason),
    started_at: attempt.startedAt.toISOString(),
    finished_at: attempt.finishedAt ? attempt.finishedAt.toISOString() : null,
  };
}
