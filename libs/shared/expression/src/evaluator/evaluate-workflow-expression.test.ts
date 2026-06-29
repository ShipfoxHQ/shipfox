import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {WorkflowExpressionEvaluationError} from './errors.js';
import {
  evaluateWorkflowExpression,
  evaluateWorkflowPredicate,
} from './evaluate-workflow-expression.js';

describe('evaluateWorkflowExpression', () => {
  it('evaluates a validated CEL expression against caller-provided values', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
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
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
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
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
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
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    const act = () =>
      evaluateWorkflowPredicate(expression, {
        event: {},
      });

    expect(act).toThrow(WorkflowExpressionEvaluationError);
  });

  it('reads dotted properties from syntax-checked plain objects', () => {
    const expression = createWorkflowExpression({
      source: 'event.pull_request.title',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, {
      event: {
        pull_request: {
          title: 'Fix auth',
        },
      },
    });

    expect(result).toBe('Fix auth');
  });

  it('returns heterogeneous nested values from syntax-checked plain objects', () => {
    const expression = createWorkflowExpression({
      source: 'event.pull_request',
      check: {mode: 'syntax'},
    });
    const pullRequest = {
      title: 'Fix auth',
      labels: [{name: 'bug'}],
      number: 42,
      draft: false,
      review: {score: 0.95},
    };

    const result = evaluateWorkflowExpression(expression, {
      event: {
        pull_request: pullRequest,
      },
    });

    expect(result).toEqual(pullRequest);
  });

  it('wraps missing paths from syntax-checked plain objects as evaluation errors', () => {
    const expression = createWorkflowExpression({
      source: 'event.nope.deep',
      check: {mode: 'syntax'},
    });

    let error: unknown;
    try {
      evaluateWorkflowExpression(expression, {
        event: {
          pull_request: {
            title: 'Fix auth',
          },
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowExpressionEvaluationError);
    expect((error as WorkflowExpressionEvaluationError).reason).toBe('missing-path');
  });

  it('classifies absent context roots as missing paths', () => {
    const expression = createWorkflowExpression({
      source: 'inputs.environment',
      check: {mode: 'syntax'},
    });

    let error: unknown;
    try {
      evaluateWorkflowExpression(expression, {event: {}});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowExpressionEvaluationError);
    expect((error as WorkflowExpressionEvaluationError).reason).toBe('missing-path');
  });

  it('classifies genuine evaluation failures as evaluation errors', () => {
    const expression = createWorkflowExpression({
      source: '1 / 0',
      check: {mode: 'syntax'},
    });

    let error: unknown;
    try {
      evaluateWorkflowExpression(expression, {});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowExpressionEvaluationError);
    expect((error as WorkflowExpressionEvaluationError).reason).toBe('evaluation-error');
  });
});
