import {
  NEXT_STEP_IN_FLIGHT_MAX,
  nextStepBodySchema,
  nextStepResponseSchema,
  reportStepBodySchema,
  STEP_RESPONSE_MAX_LENGTH,
} from './job-execution.js';

describe('nextStepBodySchema', () => {
  it('lists the attempts the runner holds', () => {
    const stepId = crypto.randomUUID();

    const parsed = nextStepBodySchema.parse({in_flight: [{step_id: stepId, attempt: 2}]});

    expect(parsed).toEqual({in_flight: [{step_id: stepId, attempt: 2}]});
  });

  it('treats a missing body or a missing list as holding nothing', () => {
    expect(nextStepBodySchema.parse(undefined)).toBeUndefined();
    expect(nextStepBodySchema.parse({})).toEqual({in_flight: []});
  });

  it('rejects a list longer than the limit', () => {
    const entry = {step_id: crypto.randomUUID(), attempt: 1};

    const result = nextStepBodySchema.safeParse({
      in_flight: Array.from({length: NEXT_STEP_IN_FLIGHT_MAX + 1}, () => entry),
    });

    expect(result.success).toBe(false);
  });
});

describe('nextStepResponseSchema', () => {
  it('accepts a server-executed tool wait response', () => {
    expect(nextStepResponseSchema.parse({kind: 'wait', retry_after_ms: 1000})).toEqual({
      kind: 'wait',
      retry_after_ms: 1000,
      cancel_step_ids: [],
    });
  });

  it('carries the steps the runner should stop on every response kind', () => {
    const stepId = crypto.randomUUID();

    const wait = nextStepResponseSchema.parse({
      kind: 'wait',
      retry_after_ms: 30_000,
      cancel_step_ids: [stepId],
    });
    const done = nextStepResponseSchema.parse({
      kind: 'done',
      status: 'succeeded',
      cancel_step_ids: [stepId],
    });

    expect(wait).toMatchObject({cancel_step_ids: [stepId]});
    expect(done).toMatchObject({cancel_step_ids: [stepId]});
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

  it('accepts a cancelled report without an error', () => {
    const result = reportStepBodySchema.safeParse({
      status: 'cancelled',
      attempt: 1,
      log_outcome: 'drained',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a cancelled report that does not name its attempt', () => {
    const result = reportStepBodySchema.safeParse({status: 'cancelled', log_outcome: 'drained'});

    expect(result.success).toBe(false);
  });

  it('rejects an error on a cancelled report and a failed report without one', () => {
    const cancelledWithError = reportStepBodySchema.safeParse({
      status: 'cancelled',
      log_outcome: 'drained',
      error: {message: 'stopped'},
    });
    const failedWithoutError = reportStepBodySchema.safeParse({
      status: 'failed',
      log_outcome: 'drained',
    });

    expect(cancelledWithError.success).toBe(false);
    expect(failedWithoutError.success).toBe(false);
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
