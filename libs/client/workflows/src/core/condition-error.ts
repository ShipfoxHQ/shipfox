import type {EvaluationTraceEntry, EvaluationTraceError} from './entities/step-attempt.js';

const CONDITION_FIELDS = new Set(['job.if', 'step.if']);
const OUTPUT_PATH = /^(?:steps|jobs)\.[^.]+\.outputs\.([^.]+)$/;

/** One sentence for steps and jobs: `run_after` rejects on success as well as on failure. */
export const RUN_AFTER_SKIP_DESCRIPTION = '`run_after` did not let this run.';

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
