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
