import {
  type AvailabilitySite,
  capTraceEntries,
  type EvaluationTraceError,
  evaluationTraceEntry,
  type PredicateEvaluationError,
  predicateTraceEntry,
  type RoutedExpression,
  type WorkflowExpression,
} from '@shipfox/expression';
import type {PersistedEvaluationTraceEntry} from './entities/step.js';

const DEFAULT_JOB_CONDITION_SOURCE = 'needs.all(n, n.status == "succeeded")';
const SUCCESS_STEP_CONDITION_SOURCE = '!execution.failed';
const FAILURE_STEP_CONDITION_SOURCE = 'execution.failed';
/** Reported when a condition cannot be filled at its site, so no evaluation error exists. */
export const UNFILLABLE_CONDITION_SUMMARY =
  'The condition reads a value that is not available here.';
const SOURCE_PATH = /^(steps|jobs|needs)\.([A-Za-z_][A-Za-z0-9_]*)(?:\.|$)/;

export function explicitConditionTrace(params: {
  readonly expression: WorkflowExpression;
  readonly field: 'job.if' | 'step.if';
  readonly route: RoutedExpression;
  readonly site: AvailabilitySite;
  readonly value: boolean;
  readonly degraded: boolean;
  readonly error?: PredicateEvaluationError | undefined;
  /** The evaluation context, used to name the status of the step or job the error path reads. */
  readonly values?: Readonly<Record<string, unknown>> | undefined;
}): readonly PersistedEvaluationTraceEntry[] {
  return capTraceEntries([
    {
      ...predicateTraceEntry({
        expression: params.expression.source,
        route: params.route,
        site: params.site,
        value: params.value,
        degraded: params.degraded,
        ...(params.error === undefined
          ? {}
          : {error: conditionTraceError(params.error, params.values ?? {})}),
      }),
      field: params.field,
    },
  ]);
}

export function defaultJobConditionTrace(): readonly PersistedEvaluationTraceEntry[] {
  return capTraceEntries([
    {
      ...evaluationTraceEntry({
        expression: DEFAULT_JOB_CONDITION_SOURCE,
        roots: ['needs'],
        fillTarget: 'job-activation',
        evaluatedAt: 'job-activation',
        value: 'false',
      }),
      field: 'job.default_gate',
    },
  ]);
}

export function defaultStepConditionTrace(
  runAfter: 'success' | 'failure',
): readonly PersistedEvaluationTraceEntry[] {
  return capTraceEntries([
    {
      ...evaluationTraceEntry({
        expression:
          runAfter === 'success' ? SUCCESS_STEP_CONDITION_SOURCE : FAILURE_STEP_CONDITION_SOURCE,
        roots: ['execution'],
        fillTarget: 'step-dispatch',
        evaluatedAt: 'step-dispatch',
        value: 'false',
      }),
      field: 'step.default_gate',
    },
  ]);
}

function conditionTraceError(
  error: PredicateEvaluationError,
  values: Readonly<Record<string, unknown>>,
): EvaluationTraceError {
  const source = error.path === undefined ? undefined : conditionErrorSource(error.path, values);
  return {
    message: error.message,
    ...(error.path === undefined ? {} : {path: error.path}),
    ...(source === undefined ? {} : {source}),
  };
}

function conditionErrorSource(
  path: string,
  values: Readonly<Record<string, unknown>>,
): EvaluationTraceError['source'] {
  const match = SOURCE_PATH.exec(path);
  const root = match?.[1];
  const key = match?.[2];
  if (root === undefined || key === undefined) return undefined;

  const status = sourceStatus(root, key, values);
  if (status === undefined) return undefined;
  return {kind: root === 'steps' ? 'step' : 'job', key, status};
}

function sourceStatus(
  root: string,
  key: string,
  values: Readonly<Record<string, unknown>>,
): string | undefined {
  const container = values[root];
  if (Array.isArray(container)) {
    const entry = container.find((candidate) => isRecord(candidate) && candidate.key === key);
    return entryStatus(entry);
  }
  return isRecord(container) ? entryStatus(container[key]) : undefined;
}

function entryStatus(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry.status === 'string' ? entry.status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
