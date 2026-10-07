import {
  createWorkflowExpression,
  evaluateWorkflowExpression,
  WorkflowExpressionEvaluationError,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
import {
  AgentConfigUnresolvableError,
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  InvalidJobRunnerLabelsError,
  isPermanentRunWorkflowError,
  JobOutputTooLargeError,
  ProjectMismatchError,
  WorkflowExecutionPayloadTooLargeError,
  WorkflowSourceSnapshotTooLargeError,
} from './errors.js';

describe('isPermanentRunWorkflowError', () => {
  test('is true for a deleted definition', () => {
    const result = isPermanentRunWorkflowError(new DefinitionNotFoundError('def-1'));

    expect(result).toBe(true);
  });

  test('is true for a project mismatch', () => {
    const result = isPermanentRunWorkflowError(new ProjectMismatchError('proj-a', 'proj-b'));

    expect(result).toBe(true);
  });

  test('is true for unresolvable agent configuration', () => {
    const result = isPermanentRunWorkflowError(new AgentConfigUnresolvableError('def-1'));

    expect(result).toBe(true);
  });

  test('is true for invalid job runner labels', () => {
    const result = isPermanentRunWorkflowError(new InvalidJobRunnerLabelsError(['has space']));

    expect(result).toBe(true);
  });

  test('is true for an oversized workflow source snapshot', () => {
    const result = isPermanentRunWorkflowError(new WorkflowSourceSnapshotTooLargeError(100, 101));

    expect(result).toBe(true);
  });

  test('is true for an oversized execution payload', () => {
    const result = isPermanentRunWorkflowError(
      new WorkflowExecutionPayloadTooLargeError('resolved_config', 100, 125),
    );

    expect(result).toBe(true);
  });

  test('is false for a plain error treated as transient', () => {
    const result = isPermanentRunWorkflowError(new Error('database unavailable'));

    expect(result).toBe(false);
  });

  test('is false for a non-error thrown value', () => {
    const result = isPermanentRunWorkflowError('boom');

    expect(result).toBe(false);
  });
});

describe('WorkflowExecutionPayloadTooLargeError', () => {
  test('reports the owning field, limit, measurement, and overshoot', () => {
    const error = new WorkflowExecutionPayloadTooLargeError('resolved_config', 100, 175);

    expect(error).toMatchObject({
      name: 'WorkflowExecutionPayloadTooLargeError',
      field: 'resolved_config',
      limitBytes: 100,
      measuredBytes: 175,
      overshootBytes: 75,
      code: 'workflow-execution-payload-too-large',
    });
    expect(error.message).toContain('measured 175 bytes; overshoot 75 bytes');
  });
});

describe('JobOutputTooLargeError', () => {
  test('reports per-value measurements and overshoot', () => {
    const error = new JobOutputTooLargeError('payload', 100, 150, 'value');

    expect(error.name).toBe('JobOutputTooLargeError');
    expect(error.overshootBytes).toBe(50);
    expect(error.message).toContain('measured 150 bytes; overshoot 50 bytes');
  });

  test('reports total measurements and overshoot', () => {
    const error = new JobOutputTooLargeError('payload', 100, 175, 'total');

    expect(error.overshootBytes).toBe(75);
    expect(error.message).toContain('measured 175 bytes; overshoot 75 bytes');
  });
});

describe('InterpolationUnresolvableError', () => {
  test('names the field and source without a definition id', () => {
    const error = new InterpolationUnresolvableError('def-1', {
      field: 'env',
      envKey: 'TOKEN',
      source: 'event.pull_request.head.sha',
    });

    expect(error.message).toBe('`env.TOKEN` could not be resolved: `event.pull_request.head.sha`');
  });

  test('names the job, step, line and reason once placed', () => {
    const error = new InterpolationUnresolvableError('def-1', {
      field: 'env',
      envKey: 'TOKEN',
      source: 'event.pull_request.head.sha',
      cause: new WorkflowTemplateResolutionError({
        source: 'event.pull_request.head.sha',
        cause: evaluationFailure('event.pull_request.head.sha', {event: {}}),
      }),
    }).at({jobKey: 'build', step: {name: 'Deploy', index: 3, line: 42}});

    expect(error.message).toBe(
      'Job `build`, step `Deploy` (line 42): `env.TOKEN` could not be resolved: `event.pull_request.head.sha`: No such key: pull_request',
    );
    expect(error).toMatchObject({
      jobKey: 'build',
      step: {index: 3},
      summary: 'No such key: pull_request',
    });
  });

  test('falls back to the step position when the step has no name', () => {
    const error = new InterpolationUnresolvableError('def-1', {
      field: 'run',
      source: 'inputs.ticket',
    }).at({jobKey: 'build', step: {index: 2}});

    expect(error.message).toBe('Job `build`, step 2: `run` could not be resolved: `inputs.ticket`');
  });

  test('says which variable is not set', () => {
    const error = new InterpolationUnresolvableError('def-1', {
      field: 'env',
      envKey: 'URL',
      source: 'vars.API_URL',
      variableKey: 'API_URL',
      jobKey: 'deploy',
      step: {name: 'Ship', index: 2},
    });

    expect(error.message).toBe(
      'Job `deploy`, step `Ship`: `env.URL` could not be resolved: `vars.API_URL`: Variable `API_URL` is not set',
    );
  });

  test('shortens a long step name', () => {
    const error = new InterpolationUnresolvableError('def-1', {
      field: 'run',
      source: 'inputs.ticket',
      jobKey: 'build',
      step: {name: 'x'.repeat(200), index: 1},
    });

    expect(error.message).toBe(
      `Job \`build\`, step \`${'x'.repeat(80)}…\`: \`run\` could not be resolved: \`inputs.ticket\``,
    );
  });
});

function evaluationFailure(source: string, context: Record<string, unknown>): unknown {
  try {
    evaluateWorkflowExpression(
      createWorkflowExpression({source, check: {mode: 'syntax'}}),
      context,
    );
  } catch (error) {
    if (error instanceof WorkflowExpressionEvaluationError) return error;
    throw error;
  }
  throw new Error('Expected the expression to fail');
}
