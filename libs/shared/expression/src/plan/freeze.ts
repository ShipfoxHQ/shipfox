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
import {shouldFillAtSite} from './fill.js';
import type {ResolvedField, ResolvedFieldDeferredSegment} from './resolved-field.js';

export type WorkflowTemplateFailurePolicy = WorkflowInterpolationFailurePolicy;

export interface WorkflowTemplateDiagnostic {
  readonly reason: 'missing-path';
  readonly expression: string;
  readonly contextRoots: readonly string[];
}

export interface FrozenResolvedField {
  readonly value: string;
  readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
}

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
      value += coerceWorkflowValueToString(
        evaluateWorkflowExpression(segment.expression, params.context),
      );
    } catch (error) {
      if (error instanceof WorkflowExpressionEvaluationError && error.reason === 'missing-path') {
        if (missingPathRequiresFailure(segment, params.failurePolicy, params.site)) {
          throw new WorkflowTemplateResolutionError({
            source: segment.expression.source,
            cause: error,
          });
        }

        diagnostics.push(missingPathDiagnostic(segment));
        continue;
      }

      throw new WorkflowTemplateResolutionError({
        source: segment.expression.source,
        cause: error,
      });
    }
  }

  return {value, diagnostics};
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
