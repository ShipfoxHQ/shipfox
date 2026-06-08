import type {
  WorkflowExpression,
  WorkflowExpressionEvaluationContext,
  WorkflowExpressionValue,
} from './workflow-expression.js';

export function evaluateWorkflowExpression(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): WorkflowExpressionValue {
  if (
    expression.kind === 'string' ||
    expression.kind === 'number' ||
    expression.kind === 'boolean'
  ) {
    return expression.value;
  }

  if (expression.kind === 'ref') {
    return readRef(expression.path, context);
  }

  if (expression.kind === 'unary') {
    return !toBoolean(evaluateWorkflowExpression(expression.argument, context));
  }

  const left = evaluateWorkflowExpression(expression.left, context);
  if (expression.op === '&&')
    return toBoolean(left) && toBoolean(evaluateWorkflowExpression(expression.right, context));
  if (expression.op === '||')
    return toBoolean(left) || toBoolean(evaluateWorkflowExpression(expression.right, context));

  const right = evaluateWorkflowExpression(expression.right, context);
  if (left === undefined || right === undefined) return false;
  if (expression.op === '==') return left === right;
  if (expression.op === '!=') return left !== right;
  if (expression.op === '<') return compareOrdered(left, right, (a, b) => a < b);
  if (expression.op === '<=') return compareOrdered(left, right, (a, b) => a <= b);
  if (expression.op === '>') return compareOrdered(left, right, (a, b) => a > b);
  return compareOrdered(left, right, (a, b) => a >= b);
}

export function evaluateWorkflowPredicate(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): boolean {
  return evaluateWorkflowExpression(expression, context) === true;
}

function readRef(
  path: readonly ['event' | 'step', ...string[]],
  context: WorkflowExpressionEvaluationContext,
): WorkflowExpressionValue {
  let current: unknown = path[0] === 'event' ? context.event : context.step;
  for (const segment of path.slice(1)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
    return current;
  }

  return undefined;
}

function toBoolean(value: WorkflowExpressionValue): boolean {
  return value === true;
}

function compareOrdered(
  left: WorkflowExpressionValue,
  right: WorkflowExpressionValue,
  compare: (left: number, right: number) => boolean,
): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  return compare(left, right);
}
