import {
  nextStepResponseSchema,
  reportStepBodySchema,
  STEP_RESPONSE_MAX_LENGTH,
} from './job-execution.js';

describe('nextStepResponseSchema', () => {
  it('accepts a server-executed tool wait response', () => {
    expect(nextStepResponseSchema.parse({kind: 'wait', retry_after_ms: 1000})).toEqual({
      kind: 'wait',
      retry_after_ms: 1000,
    });
  });

  it('rejects a non-positive wait interval', () => {
    expect(nextStepResponseSchema.safeParse({kind: 'wait', retry_after_ms: 0}).success).toBe(false);
  });
});

describe('reportStepBodySchema', () => {
  it('accepts a capped agent response', () => {
    const parsed = reportStepBodySchema.parse({
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
      log_outcome: 'drained',
      response: 'done',
    });

    expect(parsed.response).toBe('done');
  });

  it('accepts a finalized absolute log path', () => {
    const parsed = reportStepBodySchema.parse({
      status: 'succeeded',
      log_outcome: 'drained',
      log_path: '/runner/logs/job-1/attempt-1.log',
    });

    expect(parsed.log_path).toBe('/runner/logs/job-1/attempt-1.log');
  });

  it('accepts a log path at the byte limit', () => {
    const logPath = `/${'a'.repeat(1023)}`;
    const parsed = reportStepBodySchema.parse({
      status: 'succeeded',
      log_outcome: 'drained',
      log_path: logPath,
    });

    expect(parsed.log_path).toBe(logPath);
  });

  it.each([
    ['a relative path', 'runner/logs/attempt.log'],
    ['a path over the byte limit', `/${'é'.repeat(512)}`],
    ['a path with a control character', '/runner/logs/attempt\n.log'],
    ['a path with a line separator', '/runner/logs/attempt\u2028.log'],
    ['a path with a paragraph separator', '/runner/logs/attempt\u2029.log'],
  ])('rejects %s', (_description, logPath) => {
    const result = reportStepBodySchema.safeParse({
      status: 'succeeded',
      log_outcome: 'drained',
      log_path: logPath,
    });

    expect(result.success).toBe(false);
  });

  it('rejects responses over the cap', () => {
    const result = reportStepBodySchema.safeParse({
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
      log_outcome: 'drained',
      response: 'x'.repeat(STEP_RESPONSE_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });
  it('accepts resolved checkout details as a dedicated report field', () => {
    const parsed = reportStepBodySchema.parse({
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
      log_outcome: 'drained',
      checkout: {
        repository: 'https://github.com/acme/api.git',
        ref: 'refs/pull/412/head',
        commit: '9f2c000000000000000000000000000000000000',
        path: '/runner/workspace/job-1',
      },
    });
    expect(parsed.checkout?.ref).toBe('refs/pull/412/head');
  });
});
