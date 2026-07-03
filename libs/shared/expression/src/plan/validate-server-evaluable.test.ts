import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {validateServerEvaluable} from './validate-server-evaluable.js';

describe('validateServerEvaluable', () => {
  it('rejects predicates that reference runner-host roots', () => {
    const expression = createWorkflowExpression({
      source: 'runner.os == "linux"',
      check: {mode: 'syntax'},
    });

    const result = validateServerEvaluable(expression);

    expect(result).toEqual({
      ok: false,
      violations: [
        {
          reason: 'runner-root-in-server-expression',
          source: 'runner.os == "linux"',
          runnerRoots: ['runner'],
        },
      ],
    });
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
