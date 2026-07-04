import {
  type EvaluationTraceEntry,
  type EvaluationTraceLimitEntry,
  freezeResolvedFieldAtSite,
  getWorkflowInterpolationFieldFailurePolicy,
  type ResolvedField,
  resolveFieldAtSite,
  type SiteResolvedField,
  type UnsafeRunInterpolationError,
  type WorkflowInterpolationField,
  type WorkflowTemplateDiagnostic,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
import {InterpolationUnresolvableError, type InterpolationUnresolvableField} from '#core/errors.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export type StepConfigField = InterpolationUnresolvableField;

export interface WorkflowStepTemplateDiagnostic extends WorkflowTemplateDiagnostic {
  readonly field: StepConfigField;
  readonly envKey?: string;
}

export interface WorkflowStepEvaluationTraceEntry extends EvaluationTraceEntry {
  readonly field: StepConfigField;
  readonly envKey?: string;
}

export type WorkflowStepEvaluationTraceRecord =
  | WorkflowStepEvaluationTraceEntry
  | EvaluationTraceLimitEntry;

export interface ResolveStepFieldParams {
  readonly field: WorkflowInterpolationField;
  readonly template: ResolvedField;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly errorField: InterpolationUnresolvableField;
  readonly envKey?: string;
}

export function resolveStepField(params: ResolveStepFieldParams): SiteResolvedField {
  try {
    return resolveFieldAtSite({
      field: params.template,
      context: params.context.values,
      site: params.context.site,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy(params.field),
    });
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      throw stepConfigInterpolationError(params, error);
    }
    throw error;
  }
}

export function freezeStepField(params: ResolveStepFieldParams): {
  readonly value: string;
  readonly diagnostics: SiteResolvedField['diagnostics'];
  readonly trace: SiteResolvedField['trace'];
} {
  try {
    return freezeResolvedFieldAtSite({
      field: params.template,
      context: params.context.values,
      site: params.context.site,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy(params.field),
    });
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      throw stepConfigInterpolationError(params, error);
    }
    throw error;
  }
}

export function completeStepField(params: ResolveStepFieldParams): string {
  return completeStepFieldWithTrace(params).value;
}

export function completeStepFieldWithTrace(params: ResolveStepFieldParams): {
  readonly value: string;
  readonly trace: SiteResolvedField['trace'];
} {
  const resolved = resolveStepField(params);
  if (resolved.kind === 'frozen') return {value: resolved.value, trace: resolved.trace};

  const source = resolved.field.segments.find((segment) => segment.kind === 'deferred')?.expression
    .source;
  throw new InterpolationUnresolvableError(params.definitionId, {
    field: params.errorField,
    source: source ?? params.field,
    ...(params.envKey === undefined ? {} : {envKey: params.envKey}),
  });
}

export function stepConfigInterpolationError(
  params: {
    readonly definitionId: string;
    readonly errorField: InterpolationUnresolvableField;
    readonly envKey?: string;
  },
  error: WorkflowTemplateResolutionError | UnsafeRunInterpolationError,
): InterpolationUnresolvableError {
  return new InterpolationUnresolvableError(params.definitionId, {
    field: params.errorField,
    source: error.source,
    ...(params.envKey === undefined ? {} : {envKey: params.envKey}),
    cause: error,
  });
}

export function literalField(value: string): ResolvedField {
  return {segments: [{kind: 'literal', value}]};
}
