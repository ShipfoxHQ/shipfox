import {createWorkflowExpression} from '@shipfox/expression-language';
import {WorkflowExpressionEvaluationError} from './errors.js';
import {
  evaluateWorkflowExpression,
  evaluateWorkflowPredicate,
} from './evaluate-workflow-expression.js';

describe('evaluateWorkflowExpression', () => {
  it('evaluates a validated CEL expression against caller-provided values', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      typeEnvironment: {
        event: {kind: 'object', fields: {conclusion: 'string'}},
      },
    });

    const result = evaluateWorkflowExpression(expression, {
      event: {conclusion: 'success'},
    });

    expect(result).toBe(true);
  });

  it('treats only the boolean true value as a passing predicate', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion',
      typeEnvironment: {
        event: {kind: 'object', fields: {conclusion: 'string'}},
      },
    });

    const result = evaluateWorkflowPredicate(expression, {
      event: {conclusion: 'success'},
    });

    expect(result).toBe(false);
  });

  it('returns true for predicates that evaluate to the boolean true value', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      typeEnvironment: {
        event: {kind: 'object', fields: {conclusion: 'string'}},
      },
    });

    const result = evaluateWorkflowPredicate(expression, {
      event: {conclusion: 'success'},
    });

    expect(result).toBe(true);
  });

  it('wraps evaluation errors when supplied values do not match the checked context', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      typeEnvironment: {
        event: {kind: 'object', fields: {conclusion: 'string'}},
      },
    });

    const act = () =>
      evaluateWorkflowPredicate(expression, {
        event: {},
      });

    expect(act).toThrow(WorkflowExpressionEvaluationError);
  });
});
