import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {evaluatePlannedPredicateAtSite} from './evaluate-planned-predicate.js';

function expression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

describe('evaluatePlannedPredicateAtSite', () => {
  it('delegates available predicates to fail-closed evaluation', () => {
    const passed = evaluatePlannedPredicateAtSite({
      expression: expression('step.exit_code == 0'),
      field: 'step.success_if',
      site: 'step-report',
      context: {step: {exit_code: 0}},
    });
    const failed = evaluatePlannedPredicateAtSite({
      expression: expression('step.exit_code == 0'),
      field: 'step.success_if',
      site: 'step-report',
      context: {step: {exit_code: 1}},
    });

    expect(passed).toEqual({value: true, evaluationFailed: false});
    expect(failed).toEqual({value: false, evaluationFailed: false});
  });

  it('fails closed when available predicate evaluation throws', () => {
    const result = evaluatePlannedPredicateAtSite({
      expression: expression('step.missing == 0'),
      field: 'step.success_if',
      site: 'step-report',
      context: {step: {}},
    });

    expect(result).toEqual({value: false, evaluationFailed: true});
  });

  it('fails closed when the predicate needs a later server fill site', () => {
    const result = evaluatePlannedPredicateAtSite({
      expression: expression('executions.all(e, e.status == "succeeded")'),
      field: 'job.success',
      site: 'run-creation',
      context: {executions: []},
    });

    expect(result).toEqual({value: false, evaluationFailed: true});
  });

  it('fails closed for runner-fill predicates', () => {
    const result = evaluatePlannedPredicateAtSite({
      expression: expression('runner.os == "linux"'),
      field: 'job.success',
      site: 'job-resolution',
      context: {runner: {os: 'linux'}},
    });

    expect(result).toEqual({value: false, evaluationFailed: true});
  });
});
