import type {StepDto, StepErrorDtoShape} from '@shipfox/api-workflows-dto';
import type {Step} from '#core/entities/step.js';

// Domain `error` is loosely typed (jsonb), but the runner contract writes
// {message, exitCode?, signal?}. Map known camelCase fields to snake_case for
// the wire DTO; pass everything else through unchanged.
function toStepErrorDto(error: Record<string, unknown> | null): StepErrorDtoShape {
  if (error === null) return null;
  const message = typeof error.message === 'string' ? error.message : '';
  const exitCode = error.exitCode;
  const signal = typeof error.signal === 'string' ? error.signal : undefined;
  return {
    message,
    ...(exitCode === null || typeof exitCode === 'number' ? {exit_code: exitCode} : {}),
    ...(signal ? {signal} : {}),
  };
}

export function toStepDto(step: Step): StepDto {
  return {
    id: step.id,
    job_id: step.jobId,
    name: step.name,
    status: step.status,
    type: step.type,
    config: step.config,
    error: toStepErrorDto(step.error),
    position: step.position,
    created_at: step.createdAt.toISOString(),
    updated_at: step.updatedAt.toISOString(),
  };
}
