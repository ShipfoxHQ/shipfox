import {
  evaluateWorkflowExpression,
  type WorkflowExpressionEvaluationContext,
  WorkflowExpressionEvaluationError,
} from '../evaluator/index.js';
import {coerceWorkflowValueToString} from '../resolver/coerce-workflow-value-to-string.js';
import {WorkflowTemplateResolutionError} from '../resolver/errors.js';
import {
  type AvailabilitySite,
  resolveContextRootAvailability,
  type WorkflowInterpolationFailurePolicy,
} from '../workflow-context/workflow-context.js';
import {type EvaluationTraceEntry, evaluationTraceEntry} from './evaluation-trace.js';
import {shouldFillAtSite} from './fill.js';
import type {
  ResolvedField,
  ResolvedFieldDeferredSegment,
  ResolvedFieldSegment,
} from './resolved-field.js';

export type WorkflowTemplateFailurePolicy = WorkflowInterpolationFailurePolicy;

export interface WorkflowTemplateDiagnostic {
  readonly reason: 'missing-path';
  readonly expression: string;
  readonly contextRoots: readonly string[];
}

export interface FrozenResolvedField {
  readonly value: string;
  readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
  readonly trace: readonly EvaluationTraceEntry[];
}

export type SiteResolvedField =
  | {
      readonly kind: 'frozen';
      readonly value: string;
      readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
      readonly trace: readonly EvaluationTraceEntry[];
    }
  | {
      readonly kind: 'residual';
      readonly field: ResolvedField;
      readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
      readonly trace: readonly EvaluationTraceEntry[];
    };

/**
 * Segment lifecycle:
 *
 * `{expr}` -> plan -> `{deferred, fillTarget}` -> freeze at a site at or after
 * `fillTarget` -> `{literal}`. Runner-fill segments are never filled server-side.
 *
 * Value fields follow their declared policy at their fill target. Predicates use
 * the planned predicate entry point and fail closed when evaluation is deferred.
 */
export function freezeResolvedFieldAtSite(params: {
  readonly field: ResolvedField;
  readonly failurePolicy: WorkflowInterpolationFailurePolicy;
  readonly site: AvailabilitySite;
  readonly context: WorkflowExpressionEvaluationContext;
}): FrozenResolvedField {
  let value = '';
  const diagnostics: WorkflowTemplateDiagnostic[] = [];
  const trace: EvaluationTraceEntry[] = [];

  for (const segment of params.field.segments) {
    if (segment.kind === 'literal') {
      value += segment.value;
      continue;
    }

    if (!shouldFillAtSite(segment.fillTarget, params.site)) {
      diagnostics.push(missingPathDiagnostic(segment));
      continue;
    }

    try {
      const literal = coerceWorkflowValueToString(
        evaluateWorkflowExpression(segment.expression, params.context),
      );
      value += literal;
      trace.push(fillTraceEntry(segment, params.site, literal));
    } catch (error) {
      if (error instanceof WorkflowExpressionEvaluationError && error.reason === 'missing-path') {
        if (missingPathRequiresFailure(segment, params.failurePolicy, params.site)) {
          throw new WorkflowTemplateResolutionError({
            source: segment.expression.source,
            cause: error,
          });
        }

        diagnostics.push(missingPathDiagnostic(segment));
        trace.push(fillTraceEntry(segment, params.site, '', true));
        continue;
      }

      throw new WorkflowTemplateResolutionError({
        source: segment.expression.source,
        cause: error,
      });
    }
  }

  return {value, diagnostics, trace};
}

export function resolveFieldAtSite(params: {
  readonly field: ResolvedField;
  readonly failurePolicy: WorkflowInterpolationFailurePolicy;
  readonly site: AvailabilitySite;
  readonly context: WorkflowExpressionEvaluationContext;
}): SiteResolvedField {
  let value = '';
  const diagnostics: WorkflowTemplateDiagnostic[] = [];
  const trace: EvaluationTraceEntry[] = [];
  const segments: ResolvedFieldSegment[] = [];
  let hasResidual = false;

  for (const segment of params.field.segments) {
    if (segment.kind === 'literal') {
      value += segment.value;
      segments.push(segment);
      continue;
    }

    if (!shouldFillAtSite(segment.fillTarget, params.site)) {
      hasResidual = true;
      segments.push(segment);
      continue;
    }

    try {
      const literal = coerceWorkflowValueToString(
        evaluateWorkflowExpression(segment.expression, params.context),
      );
      value += literal;
      segments.push({kind: 'literal', value: literal});
      trace.push(fillTraceEntry(segment, params.site, literal));
    } catch (error) {
      if (error instanceof WorkflowExpressionEvaluationError && error.reason === 'missing-path') {
        if (missingPathRequiresFailure(segment, params.failurePolicy, params.site)) {
          throw new WorkflowTemplateResolutionError({
            source: segment.expression.source,
            cause: error,
          });
        }

        diagnostics.push(missingPathDiagnostic(segment));
        segments.push({kind: 'literal', value: ''});
        trace.push(fillTraceEntry(segment, params.site, '', true));
        continue;
      }

      throw new WorkflowTemplateResolutionError({
        source: segment.expression.source,
        cause: error,
      });
    }
  }

  if (hasResidual) return {kind: 'residual', field: {segments}, diagnostics, trace};
  return {kind: 'frozen', value, diagnostics, trace};
}

function fillTraceEntry(
  segment: ResolvedFieldDeferredSegment,
  site: AvailabilitySite,
  value: string,
  degraded = false,
): EvaluationTraceEntry {
  return evaluationTraceEntry({
    expression: segment.expression.source,
    roots: segment.roots,
    fillTarget: segment.fillTarget,
    evaluatedAt: site,
    value,
    ...(degraded ? {degraded: true} : {}),
  });
}

function missingPathDiagnostic(segment: ResolvedFieldDeferredSegment): WorkflowTemplateDiagnostic {
  return {
    reason: 'missing-path',
    expression: segment.expression.source,
    contextRoots: segment.roots,
  };
}

function missingPathRequiresFailure(
  segment: ResolvedFieldDeferredSegment,
  failurePolicy: WorkflowInterpolationFailurePolicy,
  site: AvailabilitySite,
): boolean {
  if (failurePolicy !== 'fail') return false;
  const rootAvailabilities = segment.roots.flatMap((root) => {
    const availability = resolveContextRootAvailability(root);
    return availability === undefined ? [] : [availability];
  });
  return (
    rootAvailabilities.length > 0 &&
    rootAvailabilities.every((availability) => shouldFillAtSite(availability, site))
  );
}
