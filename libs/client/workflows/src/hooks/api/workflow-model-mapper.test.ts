import {toWorkflowJobGateResult, toWorkflowJobStepError} from './workflow-model-mapper.js';

describe('toWorkflowJobStepError', () => {
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
