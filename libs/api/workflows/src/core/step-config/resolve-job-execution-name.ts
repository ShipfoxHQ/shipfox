import type {WorkflowModel} from '@shipfox/api-definitions';
import {
  getWorkflowInterpolationFieldFailurePolicy,
  resolveFieldAtSite,
  type WorkflowExpressionEvaluationContext,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
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

export function resolveJobExecutionName(params: ResolveJobExecutionNameParams): string {
  if (params.job.name === undefined) return params.fallbackName;

  try {
    const resolved = resolveFieldAtSite({
      field: {segments: params.job.name},
      site: 'execution-creation',
      context: params.context,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy('job.name'),
    });
    return resolved.kind === 'frozen' && resolved.value !== ''
      ? resolved.value
      : params.fallbackName;
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
