import {reportStepBodySchema, STEP_RESPONSE_MAX_LENGTH} from './job-execution.js';

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
});
