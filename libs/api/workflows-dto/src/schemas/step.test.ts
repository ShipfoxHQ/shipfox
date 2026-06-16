import {stepAttemptDtoSchema, stepDtoSchema, stepSourceLocationSchema} from './step.js';

const baseStep = {
  id: '11111111-1111-4111-8111-111111111111',
  job_id: '22222222-2222-4222-8222-222222222222',
  name: null,
  status: 'pending',
  type: 'run',
  config: {run: 'echo hello'},
  error: null,
  position: 1,
  current_attempt: 1,
  created_at: '2026-06-16T00:00:00.000Z',
  updated_at: '2026-06-16T00:00:00.000Z',
};

const baseAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  step_id: '22222222-2222-4222-8222-222222222222',
  job_id: '33333333-3333-4333-8333-333333333333',
  attempt: 1,
  status: 'succeeded',
  exit_code: 0,
  output: null,
  error: null,
  gate_result: null,
  restart_reason: null,
  restart_result: null,
  started_at: '2026-01-01T00:00:00.000Z',
  finished_at: '2026-01-01T00:01:00.000Z',
};

describe('step source location schemas', () => {
  test('accepts valid source locations', () => {
    const result = stepSourceLocationSchema.parse({start_line: 5, end_line: 8});

    expect(result).toEqual({start_line: 5, end_line: 8});
  });

  test('rejects inverted source locations', () => {
    const result = stepSourceLocationSchema.safeParse({start_line: 8, end_line: 5});

    expect(result.success).toBe(false);
  });

  test('accepts step DTOs with source locations', () => {
    const result = stepDtoSchema.parse({
      ...baseStep,
      source_location: {start_line: 5, end_line: 8},
    });

    expect(result.source_location).toEqual({start_line: 5, end_line: 8});
  });

  test('accepts step DTOs with null source locations', () => {
    const result = stepDtoSchema.parse({...baseStep, source_location: null});

    expect(result.source_location).toBeNull();
  });
});

describe('stepAttemptDtoSchema', () => {
  it('accepts an attempt with no gate or restart result', () => {
    const result = stepAttemptDtoSchema.parse(baseAttempt);

    expect(result.gate_result).toBeNull();
    expect(result.restart_result).toBeNull();
  });

  it('accepts typed gate and restart results', () => {
    const attempt = {
      ...baseAttempt,
      status: 'failed',
      exit_code: 1,
      gate_result: {
        kind: 'failed',
        passed: false,
        source: 'exit_code == 0',
        exit_code: 1,
      },
      restart_reason: 'gate condition not met',
      restart_result: {
        kind: 'restart_enqueued',
        reason: 'gate condition not met',
      },
    };

    const result = stepAttemptDtoSchema.parse(attempt);

    expect(result.gate_result).toEqual({
      kind: 'failed',
      passed: false,
      source: 'exit_code == 0',
      exit_code: 1,
    });
    expect(result.restart_result).toEqual({
      kind: 'restart_enqueued',
      reason: 'gate condition not met',
    });
  });

  it('accepts an explicit unknown gate result for legacy data', () => {
    const attempt = {
      ...baseAttempt,
      gate_result: {
        kind: 'unknown',
        data: {passed: 'yes'},
      },
    };

    const result = stepAttemptDtoSchema.parse(attempt);

    expect(result.gate_result).toEqual({
      kind: 'unknown',
      data: {passed: 'yes'},
    });
  });

  it('rejects inconsistent typed gate results', () => {
    const result = stepAttemptDtoSchema.safeParse({
      ...baseAttempt,
      gate_result: {
        kind: 'passed',
        passed: false,
        source: 'exit_code == 0',
        exit_code: 1,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects unsupported restart result kinds', () => {
    const result = stepAttemptDtoSchema.safeParse({
      ...baseAttempt,
      restart_result: {
        kind: 'restart_exhausted',
        reason: 'too many attempts',
      },
    });

    expect(result.success).toBe(false);
  });
});
