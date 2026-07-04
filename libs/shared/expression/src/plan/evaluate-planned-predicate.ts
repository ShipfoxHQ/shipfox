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
import {routeExpression} from './route-expression.js';

export function evaluatePlannedPredicateAtSite(params: {
  readonly expression: WorkflowExpression;
  readonly field: WorkflowPredicateField;
  readonly site: AvailabilitySite;
  readonly context: WorkflowExpressionEvaluationContext;
}): FailClosedPredicateOutcome {
  void params.field;
  const route = routeExpression(params.expression);
  if (!shouldFillAtSite(route.fillTarget, params.site)) {
    return {value: false, evaluationFailed: true};
  }

  return evaluateWorkflowPredicateFailClosed(params.expression, params.context);
}
