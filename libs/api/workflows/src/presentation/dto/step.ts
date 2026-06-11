import type {StepDto, StepErrorDtoShape} from '@shipfox/api-workflows-dto';
import type {Step} from '#core/entities/step.js';

// Domain `error` is loosely typed (jsonb), so narrow it to the fixed runner
// contract rather than trusting whatever shape the row happens to hold.
function toStepErrorDto(error: Record<string, unknown> | null): StepErrorDtoShape {
  if (error === null) return null;
  const message = typeof error.message === 'string' ? error.message : '';
  const exitCode = error.exitCode;
  const signal = typeof error.signal === 'string' ? error.signal : undefined;
  return {
    message,
    ...(exitCode === null || typeof exitCode === 'number' ? {exit_code: exitCode} : {}),
    ...(signal === undefined ? {} : {signal}),
  };
}

// Inverse of toStepErrorDto: reported wire errors land on the domain row in
// camelCase so the read path renders them back without a special case.
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
