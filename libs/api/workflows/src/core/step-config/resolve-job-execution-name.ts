import type {WorkflowModel} from '@shipfox/api-definitions';
import {
  capTraceEntries,
  getWorkflowInterpolationFieldFailurePolicy,
  resolveFieldAtSite,
  type WorkflowExpressionEvaluationContext,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';
import {InterpolationUnresolvableError} from '#core/errors.js';

interface WorkflowModelJobName {
  readonly name?: WorkflowModel['jobs'][number]['name'] | undefined;
}

export interface ResolveJobExecutionNameParams {
  readonly definitionId: string;
  readonly job: WorkflowModelJobName;
  readonly fallbackName: string;
  readonly context: WorkflowExpressionEvaluationContext;
}

export function resolveJobExecutionName(params: ResolveJobExecutionNameParams): {
  readonly value: string;
  readonly trace: readonly PersistedEvaluationTraceEntry[];
} {
  if (params.job.name === undefined) return {value: params.fallbackName, trace: []};

  try {
    const resolved = resolveFieldAtSite({
      field: {segments: params.job.name},
      site: 'execution-creation',
      context: params.context,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy('job.name'),
    });
    return {
      value:
        resolved.kind === 'frozen' && resolved.value !== '' ? resolved.value : params.fallbackName,
      trace: capTraceEntries(resolved.trace.map((entry) => ({...entry, field: 'job.name'}))),
    };
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      throw new InterpolationUnresolvableError(params.definitionId, {
        field: 'job.name',
        source: error.source,
        cause: error,
      });
    }
    throw error;
  }
}
