import {evaluate} from '@marcbachmann/cel-js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {WorkflowExpressionEvaluationError} from './errors.js';

export type WorkflowExpressionEvaluationContext = Readonly<Record<string, unknown>>;
export type WorkflowExpressionEvaluationValue = unknown;

export function evaluateWorkflowExpression(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): WorkflowExpressionEvaluationValue {
  try {
    return evaluate(expression.source, context);
  } catch (error) {
    throw new WorkflowExpressionEvaluationError(error);
  }
}

export function evaluateWorkflowPredicate(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): boolean {
  return evaluateWorkflowExpression(expression, context) === true;
}

export interface FailClosedPredicateOutcome {
  readonly value: boolean;
  readonly evaluationFailed: boolean;
}

export function evaluateWorkflowPredicateFailClosed(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): FailClosedPredicateOutcome {
  try {
    return {value: evaluateWorkflowPredicate(expression, context), evaluationFailed: false};
  } catch (error) {
    if (error instanceof WorkflowExpressionEvaluationError) {
      return {value: false, evaluationFailed: true};
    }
    throw error;
  }
}
