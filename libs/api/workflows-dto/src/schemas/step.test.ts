import {stepAttemptDtoSchema} from './step.js';

const baseAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  step_id: '22222222-2222-4222-8222-222222222222',
  job_id: '33333333-3333-4333-8333-333333333333',
  attempt: 1,
  status: 'succeeded',
  exit_code: 0,
  output: null,
  error: null,
  restart_reason: null,
  restart_result: null,
  started_at: '2026-01-01T00:00:00.000Z',
  finished_at: '2026-01-01T00:01:00.000Z',
};

describe('stepAttemptDtoSchema', () => {
  it('accepts an attempt with no gate or restart result', () => {
    const attempt = {...baseAttempt, gate_result: null};

    const result = stepAttemptDtoSchema.parse(attempt);

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
      gate_result: null,
      restart_result: {
        kind: 'restart_exhausted',
        reason: 'too many attempts',
      },
    });

    expect(result.success).toBe(false);
  });
});
