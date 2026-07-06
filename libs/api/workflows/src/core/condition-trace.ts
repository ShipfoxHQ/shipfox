import {
  type AvailabilitySite,
  capTraceEntries,
  evaluationTraceEntry,
  predicateTraceEntry,
  type RoutedExpression,
  type WorkflowExpression,
} from '@shipfox/expression';
import type {PersistedEvaluationTraceEntry} from './entities/step.js';

const DEFAULT_JOB_CONDITION_SOURCE = 'needs.all(n, n.status == "succeeded")';
const DEFAULT_STEP_CONDITION_SOURCE = '!execution.failed';

export function explicitConditionTrace(params: {
  readonly expression: WorkflowExpression;
  readonly field: 'job.if' | 'step.if';
  readonly route: RoutedExpression;
  readonly site: AvailabilitySite;
  readonly value: boolean;
  readonly degraded: boolean;
}): readonly PersistedEvaluationTraceEntry[] {
  return capTraceEntries([
    {
      ...predicateTraceEntry({
        expression: params.expression.source,
        route: params.route,
        site: params.site,
        value: params.value,
        degraded: params.degraded,
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

export function defaultStepConditionTrace(): readonly PersistedEvaluationTraceEntry[] {
  return capTraceEntries([
    {
      ...evaluationTraceEntry({
        expression: DEFAULT_STEP_CONDITION_SOURCE,
        roots: ['execution'],
        fillTarget: 'step-dispatch',
        evaluatedAt: 'step-dispatch',
        value: 'false',
      }),
      field: 'step.default_gate',
    },
  ]);
}
