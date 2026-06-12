import type {Step} from '#core/entities/step.js';
import {fromStepErrorDto, toStepDto} from './step.js';

function step(overrides: Partial<Step> & {type: string}): Step {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    jobId: '00000000-0000-0000-0000-0000000000aa',
    name: null,
    status: 'failed',
    config: {},
    output: null,
    error: null,
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('fromStepErrorDto', () => {
  it('persists the machine-readable reason in camelCase', () => {
    const persisted = fromStepErrorDto({message: 'mkdir denied', reason: 'workspace_prep_failed'});

    expect(persisted).toEqual({message: 'mkdir denied', reason: 'workspace_prep_failed'});
  });

  it('ignores a runner-supplied category (the server derives it on read)', () => {
    const persisted = fromStepErrorDto({
      message: 'mkdir denied',
      reason: 'workspace_prep_failed',
      category: 'setup',
    });

    expect(persisted).not.toHaveProperty('category');
  });

  it('returns null for a missing error', () => {
    expect(fromStepErrorDto(undefined)).toBeNull();
    expect(fromStepErrorDto(null)).toBeNull();
  });
});

describe('toStepDto error category', () => {
  it("derives category 'setup' for a setup step error and surfaces the reason", () => {
    const dto = toStepDto(
      step({type: 'setup', error: {message: 'mkdir denied', reason: 'workspace_prep_failed'}}),
    );

    expect(dto.error).toEqual({
      message: 'mkdir denied',
      reason: 'workspace_prep_failed',
      category: 'setup',
    });
  });

  it("derives category 'user' for a run step error", () => {
    const dto = toStepDto(
      step({type: 'run', error: {message: 'Command exited with code 1', exitCode: 1}}),
    );

    expect(dto.error).toEqual({
      message: 'Command exited with code 1',
      exit_code: 1,
      category: 'user',
    });
  });

  it('renders no error (and no category) for a successful step', () => {
    const dto = toStepDto(step({type: 'run', status: 'succeeded', error: null}));

    expect(dto.error).toBeNull();
  });
});
