import {
  evaluateWorkflowPredicateFailClosed,
  type FailClosedPredicateOutcome,
  type WorkflowExpressionEvaluationContext,
} from '../evaluator/evaluate-workflow-expression.js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';
import type {
  AvailabilitySite,
  WorkflowPredicateField,
} from '../workflow-context/workflow-context.js';
import {shouldFillAtSite} from './fill.js';
import {type RoutedExpression, routeExpression} from './route-expression.js';

export interface PlannedPredicateEvaluationResult extends FailClosedPredicateOutcome {
  readonly route: RoutedExpression;
}

export function evaluatePlannedPredicateAtSite(params: {
  readonly expression: WorkflowExpression;
  readonly field: WorkflowPredicateField;
  readonly site: AvailabilitySite;
  readonly context: WorkflowExpressionEvaluationContext;
}): PlannedPredicateEvaluationResult {
  void params.field;
  const route = routeExpression(params.expression);
  if (!shouldFillAtSite(route.fillTarget, params.site)) {
    return {value: false, evaluationFailed: true, route};
  }

  return {...evaluateWorkflowPredicateFailClosed(params.expression, params.context), route};
}
