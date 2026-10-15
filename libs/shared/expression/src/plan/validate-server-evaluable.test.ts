import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {validateServerEvaluable} from './validate-server-evaluable.js';

describe('validateServerEvaluable', () => {
  it('rejects predicates that reference runner-host roots', () => {
    const expression = createWorkflowExpression({
      source: 'secrets.TOKEN == "x"',
      check: {mode: 'syntax'},
    });

    const result = validateServerEvaluable(expression);

    expect(result).toEqual({
      ok: false,
      violations: [
        {
          reason: 'runner-root-in-server-expression',
          source: 'secrets.TOKEN == "x"',
          runnerRoots: ['secrets'],
        },
      ],
    });
  });

  it('rejects predicates that call a runner function', () => {
    const source = 'hashFiles("package-lock.json") == "x"';
    const expression = createWorkflowExpression({source, check: {mode: 'syntax'}});

    const result = validateServerEvaluable(expression);

    expect(result).toEqual({
      ok: false,
      violations: [{reason: 'runner-call-in-server-expression', source, function: 'hashFiles'}],
    });
  });

  it('accepts the runner context, which the server fills', () => {
    const expression = createWorkflowExpression({
      source: 'runner.arch == "arm64"',
      check: {mode: 'syntax'},
    });

    const result = validateServerEvaluable(expression);

    expect(result).toEqual({ok: true});
  });

  it.each([
    'step.exit_code == 0',
    'executions.all(e, e.status == "succeeded")',
  ])('accepts server-evaluable expression: %s', (source) => {
    const expression = createWorkflowExpression({source, check: {mode: 'syntax'}});

    const result = validateServerEvaluable(expression);

    expect(result).toEqual({ok: true});
  });

  it('does not confuse a macro alias named runner with the runner root', () => {
    const expression = createWorkflowExpression({
      source: 'executions.all(runner, runner.status == "succeeded")',
      check: {mode: 'syntax'},
    });

    const result = validateServerEvaluable(expression);

    expect(result).toEqual({ok: true});
  });
});
