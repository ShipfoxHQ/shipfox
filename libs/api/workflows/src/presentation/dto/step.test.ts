import type {Step, StepAttempt} from '#core/entities/step.js';
import {fromStepErrorDto, toStepAttemptDto, toStepDto} from './step.js';

function step(overrides: Partial<Step> & {type: string}): Step {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    jobId: '00000000-0000-0000-0000-0000000000aa',
    name: null,
    displayName: 'step',
    sourceLocation: null,
    status: 'failed',
    config: {},
    authoredConfig: null,
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

  it("derives category 'user' for an agent config error and surfaces the reason", () => {
    const dto = toStepDto(
      step({
        type: 'agent',
        error: {message: 'Unknown provider "foo" for agent step.', reason: 'agent_config_invalid'},
      }),
    );

    expect(dto.error).toEqual({
      message: 'Unknown provider "foo" for agent step.',
      reason: 'agent_config_invalid',
      category: 'user',
    });
  });

  it('renders no error (and no category) for a successful step', () => {
    const dto = toStepDto(step({type: 'run', status: 'succeeded', error: null}));

    expect(dto.error).toBeNull();
  });

  it('maps source locations to snake_case', () => {
    const dto = toStepDto(
      step({type: 'run', sourceLocation: {startLine: 5, endLine: 8}, error: null}),
    );

    expect(dto.source_location).toEqual({start_line: 5, end_line: 8});
  });

  it('maps missing source locations to null', () => {
    const dto = toStepDto(step({type: 'setup', sourceLocation: null, error: null}));

    expect(dto.source_location).toBeNull();
  });
});

const baseAttempt: StepAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  stepId: '22222222-2222-4222-8222-222222222222',
  jobId: '33333333-3333-4333-8333-333333333333',
  attempt: 1,
  executionOrder: 1,
  status: 'failed',
  output: null,
  error: null,
  exitCode: 1,
  gateResult: {passed: 'yes'},
  restartReason: null,
  logOutcome: null,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: new Date('2026-01-01T00:01:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('toStepAttemptDto', () => {
  it('maps passed gate payloads to typed gate results', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      status: 'succeeded',
      exitCode: 0,
      gateResult: {passed: true, source: 'exit_code == 0', exit_code: 0},
    };

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'passed',
      passed: true,
      source: 'exit_code == 0',
      exit_code: 0,
    });
  });

  it('maps failed gate payloads to typed gate results', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      gateResult: {passed: false, source: 'exit_code == 0', exit_code: 1},
    };

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'failed',
      passed: false,
      source: 'exit_code == 0',
      exit_code: 1,
    });
  });

  it('maps uncheckable gate payloads before generic failed payloads', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      gateResult: {passed: false, uncheckable: true, reason: 'missing output', exit_code: null},
    };

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: 'missing output',
      exit_code: null,
    });
  });

  it('maps missing gate payloads to an explicit none result', () => {
    const attempt: StepAttempt = {...baseAttempt, gateResult: null};

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({kind: 'none'});
    expect(result.restart_result).toBeNull();
  });

  it('maps running attempts without gate payloads to not evaluated', () => {
    const attempt: StepAttempt = {...baseAttempt, status: 'running', gateResult: null};

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({kind: 'not_evaluated'});
  });

  it('maps gate expression failures to typed evaluation errors', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      gateResult: {
        passed: false,
        uncheckable: true,
        reason: 'gate expression evaluation failed',
        exit_code: 1,
      },
    };

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'evaluation_error',
      reason: 'gate expression evaluation failed',
      exit_code: 1,
    });
  });

  it('maps restart reasons to typed restart results', () => {
    const attempt: StepAttempt = {...baseAttempt, restartReason: 'gate condition not met'};

    const result = toStepAttemptDto(attempt);

    expect(result.restart_result).toEqual({
      kind: 'restart_enqueued',
      reason: 'gate condition not met',
    });
  });

  it('maps restart-exhausted errors to typed restart results', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      error: {
        kind: 'restart_exhausted',
        maxAttempts: 3,
        restart_from: 'producer',
      },
    };

    const result = toStepAttemptDto(attempt);

    expect(result.restart_result).toEqual({
      kind: 'restart_exhausted',
      max_attempts: 3,
      restart_from: 'producer',
    });
  });

  it('maps restart-exhausted errors with camelCase restart targets', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      error: {
        kind: 'restart_exhausted',
        max_attempts: 3,
        restartFrom: 'producer',
      },
    };

    const result = toStepAttemptDto(attempt);

    expect(result.restart_result).toEqual({
      kind: 'restart_exhausted',
      max_attempts: 3,
      restart_from: 'producer',
    });
  });

  it('maps legacy gate payloads to an explicit unknown result', () => {
    const attempt = baseAttempt;

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'unknown',
      data: {passed: 'yes'},
    });
  });
});
