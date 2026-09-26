import {
  InterpolationUnresolvableError,
  JobOutputNotJsonSafeError,
  JobOutputTooLargeError,
  JobOutputTooManyEntriesError,
  WorkflowDiagnosticTooLargeError,
} from './errors.js';
import {classifyOutputFailure} from './output-failure.js';

describe('classifyOutputFailure', () => {
  test.each([
    [
      new InterpolationUnresolvableError('definition-1', {
        field: 'job.outputs',
        source: 'steps.collect.outputs.payload',
      }),
      'output_invalid',
    ],
    [new JobOutputNotJsonSafeError('payload', 'undefined is not a JSON value'), 'output_invalid'],
    [new JobOutputTooManyEntriesError(11, 10), 'output_invalid'],
    [new JobOutputTooLargeError('payload', 16 * 1024, 16 * 1024 + 1, 'value'), 'output_too_large'],
  ] as const)('classifies %s with the persisted reason', (error, statusReason) => {
    expect(classifyOutputFailure(error)).toMatchObject({statusReason});
  });

  test('does not classify legacy diagnostic overages as product output failures', () => {
    expect(
      classifyOutputFailure(new WorkflowDiagnosticTooLargeError('execution_outputs', 1024, 2048)),
    ).toBeNull();
  });

  test('classifies workflow output interpolation failures only for workflow outputs', () => {
    const error = new InterpolationUnresolvableError('definition-1', {
      field: 'workflow.outputs',
      source: 'jobs.build.outputs.version',
      envKey: 'version',
    });

    expect(classifyOutputFailure(error, 'workflow.outputs')).toMatchObject({
      statusReason: 'output_invalid',
    });
    expect(classifyOutputFailure(error)).toBeNull();
  });

  test('does not classify interpolation failures outside job outputs', () => {
    const error = new InterpolationUnresolvableError('definition-1', {
      field: 'env',
      source: 'event.ref',
      envKey: 'REF',
    });

    expect(classifyOutputFailure(error)).toBeNull();
  });

  test('does not classify unexpected failures', () => {
    expect(classifyOutputFailure(new Error('database unavailable'))).toBeNull();
  });

  test('bounds the persisted message', () => {
    const failure = classifyOutputFailure(
      new JobOutputNotJsonSafeError('payload', 'x'.repeat(4096)),
    );

    expect(failure?.statusReasonMessage).toHaveLength(2048);
    expect(failure?.statusReasonMessage.endsWith('…')).toBe(true);
  });
});
