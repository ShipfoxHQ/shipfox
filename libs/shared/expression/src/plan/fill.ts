import {
  evaluateWorkflowExpression,
  type WorkflowExpressionEvaluationContext,
} from '../evaluator/evaluate-workflow-expression.js';
import {coerceWorkflowValueToString} from '../resolver/coerce-workflow-value-to-string.js';
import {type AvailabilitySite, availabilitySites} from '../workflow-context/workflow-context.js';
import type {ResolvedField} from './resolved-field.js';

export function fillResolvedFieldAtSite(params: {
  readonly field: ResolvedField;
  readonly site: AvailabilitySite;
  readonly context: WorkflowExpressionEvaluationContext;
}): ResolvedField {
  return {
    segments: params.field.segments.map((segment) => {
      if (segment.kind === 'literal') return segment;
      if (!shouldFillAtSite(segment.fillTarget, params.site)) return segment;

      return {
        kind: 'literal',
        value: coerceWorkflowValueToString(
          evaluateWorkflowExpression(segment.expression, params.context),
        ),
      };
    }),
  };
}

function shouldFillAtSite(fillTarget: string, site: AvailabilitySite): boolean {
  const fillTargetIndex = availabilitySites.indexOf(fillTarget as AvailabilitySite);
  if (fillTargetIndex < 0) return false;

  return fillTargetIndex <= availabilitySites.indexOf(site);
}
