import {toWorkflowJobGateResult, toWorkflowJobStepError} from './workflow-model-mapper.js';

describe('toWorkflowJobStepError', () => {
  test('maps provider interruption diagnostics to the client model', () => {
    const error = toWorkflowJobStepError({
      message: 'The model response stream was interrupted after 4 attempts.',
      code: 'provider_stream_interrupted',
      reason: 'agent_invocation_failed',
      category: 'provider',
      retryable: true,
      attempt_count: 4,
      max_attempts: 4,
    });

    expect(error).toMatchObject({
      code: 'provider_stream_interrupted',
      reason: 'agent_invocation_failed',
      category: 'provider',
      retryable: true,
      attemptCount: 4,
      maxAttempts: 4,
    });
  });

  test('maps gate reason and restart diagnostics to the client model', () => {
    const error = toWorkflowJobStepError({
      message: 'The gate did not pass after 1 attempt.',
      reason: 'restart_exhausted',
      retryable: false,
      source: 'step.exit_code == 0',
      attempt_count: 1,
      max_attempts: 1,
      restart_from: 'implement',
    });

    expect(error).toEqual({
      message: 'The gate did not pass after 1 attempt.',
      source: 'step.exit_code == 0',
      exitCode: null,
      signal: undefined,
      reason: 'restart_exhausted',
      agentConfigIssue: undefined,
      category: undefined,
      retryable: false,
      attemptCount: 1,
      maxAttempts: 1,
      restartFrom: 'implement',
    });
  });
});

describe('toWorkflowJobGateResult', () => {
  test('maps an uncheckable gate source to the client model', () => {
    const result = toWorkflowJobGateResult({
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: 'step produced no exit code',
      source: 'step.exit_code == 0',
      exit_code: null,
    });

    expect(result).toEqual({
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: 'step produced no exit code',
      source: 'step.exit_code == 0',
      exitCode: null,
    });
  });
});
