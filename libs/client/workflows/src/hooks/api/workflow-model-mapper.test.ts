import {evaluationTraceSchema} from '@shipfox/api-workflows-dto';
import {conditionErrorDescription} from '#core/condition-error.js';
import {
  toEvaluationTrace,
  toWorkflowJobGateResult,
  toWorkflowJobStepError,
} from './workflow-model-mapper.js';

function conditionTraceDto(error: Record<string, unknown> | undefined) {
  return evaluationTraceSchema.parse([
    {
      expression: 'jobs.write.outputs.created_branch != ""',
      roots: ['jobs'],
      fill_target: 'job-activation',
      evaluated_at: 'job-activation',
      field: 'job.if',
      value: 'false',
      degraded: true,
      ...(error === undefined ? {} : {error}),
    },
  ]);
}

describe('toEvaluationTrace', () => {
  test('maps the condition error and its source to the client model', () => {
    const trace = toEvaluationTrace(
      conditionTraceDto({
        message: 'No such key: created_branch',
        path: 'jobs.write.outputs.created_branch',
        source: {kind: 'job', key: 'write', status: 'skipped'},
      }),
    );

    expect(trace?.[0]).toMatchObject({
      error: {
        message: 'No such key: created_branch',
        path: 'jobs.write.outputs.created_branch',
        source: {kind: 'job', key: 'write', status: 'skipped'},
      },
    });
  });

  test('leaves an entry without an error unchanged', () => {
    const trace = toEvaluationTrace(conditionTraceDto(undefined));

    expect(trace?.[0]).not.toHaveProperty('error');
  });

  test('names a skipped job output from the DTO through to the copy', () => {
    const trace = toEvaluationTrace(
      conditionTraceDto({
        message: 'No such key: created_branch',
        path: 'jobs.write.outputs.created_branch',
        source: {kind: 'job', key: 'write', status: 'skipped'},
      }),
    );

    expect(conditionErrorDescription(trace)).toBe(
      '`jobs.write.outputs.created_branch` has no value because job `write` was skipped.',
    );
  });

  test('names an output a succeeded step did not report from the DTO through to the copy', () => {
    const trace = toEvaluationTrace(
      conditionTraceDto({
        message: 'No such key: status',
        path: 'steps.fix.outputs.status',
        source: {kind: 'step', key: 'fix', status: 'succeeded'},
      }),
    );

    expect(conditionErrorDescription(trace)).toBe(
      '`steps.fix.outputs.status` has no value. Step `fix` succeeded but did not report `status`.',
    );
  });

  test('reports the CEL message when the error has no source', () => {
    const trace = toEvaluationTrace(
      conditionTraceDto({message: 'CEL evaluation failed (division_by_zero)'}),
    );

    expect(conditionErrorDescription(trace)).toBe(
      'Shipfox cannot evaluate the if condition: CEL evaluation failed (division_by_zero)',
    );
  });

  test('has no description for a trace stored without an error', () => {
    expect(conditionErrorDescription(toEvaluationTrace(conditionTraceDto(undefined)))).toBeNull();
  });
});

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
