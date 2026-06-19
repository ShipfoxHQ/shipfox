import {randomUUID} from 'node:crypto';
import type {NextStepResponseDto, StepDto} from '@shipfox/api-workflows-dto';

// Shared step fixtures for the harness unit tests and the converted orchestration
// unit tests, so the StepDto shape lives in one place.

const JOB_ID = '00000000-0000-0000-0000-0000000000aa';

export function buildStep(overrides: Partial<StepDto> = {}): StepDto {
  return {
    id: randomUUID(),
    job_id: JOB_ID,
    name: 'test-step',
    status: 'running',
    type: 'run',
    config: {run: 'echo test'},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function setupStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({name: 'Set up job', type: 'setup', config: {}, position: 0, ...overrides});
}

export function runStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({position: 1, ...overrides});
}

export function stepResponse(step: StepDto, attempt = 1): NextStepResponseDto {
  return {kind: 'step', step, attempt};
}
