import type {EvaluationTraceEntry, EvaluationTraceError} from './entities/step-attempt.js';

const CONDITION_FIELDS = new Set(['job.if', 'step.if']);
const OUTPUT_PATH = /^(?:steps|jobs)\.[^.]+\.outputs\.([^.]+)$/;

// The trace expressions the API stores when `run_after: failure` rejects.
const FAILURE_GATE_EXPRESSIONS = new Set([
  'execution.failed',
  'needs.exists(n, n.status == "failed")',
]);

/**
 * Says why `run_after` skipped a step or job and which value changes that. The trace tells
 * the default apart from `run_after: failure`, which skips because nothing failed.
 */
export function runAfterSkipDescription(
  kind: 'step' | 'job',
  trace: readonly EvaluationTraceEntry[] | null | undefined,
): string {
  const waitsForFailure = trace?.some(
    (entry) =>
      !('dropped' in entry) &&
      entry.field.endsWith('.default_gate') &&
      FAILURE_GATE_EXPRESSIONS.has(entry.expression),
  );

  if (kind === 'step') {
    return waitsForFailure
      ? 'This step has `run_after: failure`, so it runs only after an earlier step fails. No earlier step failed.'
      : 'An earlier step in this job failed, so Shipfox skipped this step. To run it after a failure, set `run_after: always` or `run_after: failure` on the step.';
  }
  return waitsForFailure
    ? 'This job has `run_after: failure`, so it runs only after a job in its `needs` fails. None of them failed.'
    : 'A job in the `needs` of this job did not succeed, so Shipfox skipped this job. To run it after a failure, set `run_after: always` or `run_after: failure` on the job.';
}

/**
 * Names the value an errored `if` condition could not read, or returns null when the trace
 * carries no error, as for conditions that errored before the trace stored it.
 */
export function conditionErrorDescription(
  trace: readonly EvaluationTraceEntry[] | null | undefined,
): string | null {
  const error = trace
    ?.flatMap((entry) =>
      !('dropped' in entry) && CONDITION_FIELDS.has(entry.field) && entry.error
        ? [entry.error]
        : [],
    )
    .at(0);
  return error ? describeConditionError(error) : null;
}

function describeConditionError({message, path, source}: EvaluationTraceError): string {
  if (path === undefined || source === undefined) {
    return `Shipfox cannot evaluate the if condition: ${message}`;
  }

  const subject = `${source.kind === 'step' ? 'Step' : 'Job'} \`${source.key}\``;
  if (source.status === 'succeeded') {
    const output = OUTPUT_PATH.exec(path)?.[1];
    if (output === undefined) return `Shipfox cannot evaluate the if condition: ${message}`;
    return `\`${path}\` has no value. ${subject} succeeded but did not report \`${output}\`.`;
  }
  return `\`${path}\` has no value because ${source.kind} \`${source.key}\` ${statusClause(source.status)}.`;
}

function statusClause(status: string): string {
  switch (status) {
    case 'skipped':
      return 'was skipped';
    case 'cancelled':
      return 'was cancelled';
    case 'failed':
      return 'failed';
    default:
      return 'has not finished';
  }
}
