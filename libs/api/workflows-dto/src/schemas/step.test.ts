import {
  STEP_ERROR_MESSAGE_MAX_LENGTH,
  stepAttemptDtoSchema,
  stepDtoSchema,
  stepErrorDtoSchema,
} from './step.js';

const baseStep = {
  id: '33333333-3333-4333-8333-333333333333',
  job_execution_id: '44444444-4444-4444-8444-444444444444',
  key: 'build',
  name: 'build',
  source_location: null,
  status: 'pending',
  status_reason: null,
  type: 'run',
  config: {},
  evaluation_trace: null,
  error: null,
  position: 0,
  current_attempt: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:01:00.000Z',
};

describe('stepDtoSchema', () => {
  it('accepts a pending step with no skip metadata', () => {
    const result = stepDtoSchema.parse(baseStep);

    expect(result).toMatchObject({status: 'pending', status_reason: null, evaluation_trace: null});
  });

  it('accepts a skipped step with its reason and condition trace', () => {
    const result = stepDtoSchema.parse({
      ...baseStep,
      status: 'skipped',
      status_reason: 'condition_rejected',
      evaluation_trace: [
        {
          field: 'step.if',
          expression: "steps.test.status == 'failed'",
          roots: ['steps'],
          fill_target: 'step-dispatch',
          evaluated_at: 'step-dispatch',
          value: 'false',
        },
      ],
    });

    expect(result.status).toBe('skipped');
    expect(result.status_reason).toBe('condition_rejected');
    expect(result.evaluation_trace).toHaveLength(1);
  });

  it('rejects a status outside the step status enum', () => {
    const result = stepDtoSchema.safeParse({...baseStep, status: 'waiting'});

    expect(result.success).toBe(false);
  });

  it('rejects a skip reason outside the step reason enum', () => {
    const result = stepDtoSchema.safeParse({
      ...baseStep,
      status: 'skipped',
      status_reason: 'dependency_not_completed',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a status_reason on a non-skipped step', () => {
    const result = stepDtoSchema.safeParse({
      ...baseStep,
      status: 'running',
      status_reason: 'condition_rejected',
    });

    expect(result.success).toBe(false);
  });
});

const baseAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  step_id: '22222222-2222-4222-8222-222222222222',
  attempt: 1,
  execution_order: 1,
  status: 'succeeded',
  exit_code: 0,
  output: null,
  outputs: null,
  response: null,
  error: null,
  restart_feedback: null,
  started_at: '2026-01-01T00:00:00.000Z',
  finished_at: '2026-01-01T00:01:00.000Z',
};

describe('stepErrorDtoSchema', () => {
  it('accepts a message at the maximum length', () => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'x'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH),
    });

    expect(result.success).toBe(true);
  });

  it('rejects a message beyond the maximum length', () => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'x'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it('accepts an agent config issue with an agent config failure reason', () => {
    const result = stepErrorDtoSchema.parse({
      message: 'Model provider credentials are not configured',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_not_configured',
    });

    expect(result).toEqual({
      message: 'Model provider credentials are not configured',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_not_configured',
    });
  });

  it('accepts typed output validation failures', () => {
    const result = stepErrorDtoSchema.parse({
      message: 'Output "count" must be a finite number or numeric string.',
      reason: 'output_invalid',
      field: 'outputs.count',
    });

    expect(result).toEqual({
      message: 'Output "count" must be a finite number or numeric string.',
      reason: 'output_invalid',
      field: 'outputs.count',
    });
  });

  it('rejects unknown agent config issues', () => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'Model provider credentials are not configured',
      reason: 'agent_config_invalid',
      agent_config_issue: 'unknown',
    });

    expect(result.success).toBe(false);
  });

  it.each([
    undefined,
    'workspace_prep_failed',
    'agent_invocation_failed',
  ] as const)('rejects an agent config issue when reason is %s', (reason) => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'Model provider credentials are not configured',
      ...(reason === undefined ? {} : {reason}),
      agent_config_issue: 'provider_not_configured',
    });

    expect(result.success).toBe(false);
  });
});

describe('stepAttemptDtoSchema', () => {
  it('accepts an attempt with no gate or restart feedback', () => {
    const attempt = {...baseAttempt, gate_result: {kind: 'none'}};

    const result = stepAttemptDtoSchema.parse(attempt);

    expect(result.gate_result).toEqual({kind: 'none'});
    expect(result.restart_feedback).toBeNull();
  });

  it('accepts not-evaluated and evaluation-error gate results', () => {
    const notEvaluated = stepAttemptDtoSchema.parse({
      ...baseAttempt,
      gate_result: {kind: 'not_evaluated'},
    });
    const evaluationError = stepAttemptDtoSchema.parse({
      ...baseAttempt,
      gate_result: {
        kind: 'evaluation_error',
        reason: 'gate expression evaluation failed',
        exit_code: 1,
      },
    });

    expect(notEvaluated.gate_result).toEqual({kind: 'not_evaluated'});
    expect(evaluationError.gate_result).toEqual({
      kind: 'evaluation_error',
      reason: 'gate expression evaluation failed',
      exit_code: 1,
    });
  });

  it('accepts typed gate results and restart feedback', () => {
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
      restart_feedback: 'gate condition not met',
    };

    const result = stepAttemptDtoSchema.parse(attempt);

    expect(result.gate_result).toEqual({
      kind: 'failed',
      passed: false,
      source: 'exit_code == 0',
      exit_code: 1,
    });
    expect(result.restart_feedback).toBe('gate condition not met');
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
});
