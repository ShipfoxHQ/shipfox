import type {WorkflowExpression} from '@shipfox/expression';
import type {WorkflowDocumentStep} from '@shipfox/workflow-document';
import type {WorkflowModelStepGate} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';
import {issue} from './validation-issue.js';

export function normalizeStepGate(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  stepId: string;
  previousStepKeys: ReadonlySet<string>;
  issues: WorkflowModelValidationIssue[];
}): WorkflowModelStepGate | undefined {
  const gate = params.step.gate;
  if (gate === undefined) return undefined;

  const success = normalizeGateSuccess({
    source: gate.success,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
  });
  const onFailure =
    gate.on_failure === undefined
      ? undefined
      : {
          restartFrom: gate.on_failure.restart_from,
          ...(gate.on_failure.feedback === undefined ? {} : {feedback: gate.on_failure.feedback}),
        };

  if (gate.on_failure !== undefined && !params.previousStepKeys.has(gate.on_failure.restart_from)) {
    params.issues.push(
      issue({
        code: 'invalid-step-gate-restart-from',
        message: `Step "${params.stepId}" must restart from an earlier keyed step; found "${gate.on_failure.restart_from}".`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'gate', 'on_failure'],
        details: {stepId: params.stepId, restartFrom: gate.on_failure.restart_from},
      }),
    );
  }

  if (success === undefined && onFailure === undefined) return undefined;

  return {
    ...(success === undefined ? {} : {success}),
    ...(onFailure === undefined ? {} : {onFailure}),
  };
}

function normalizeGateSuccess(params: {
  source: string | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): WorkflowExpression | undefined {
  if (params.source === undefined) return undefined;

  return validatePredicateExpression({
    field: 'step.success',
    source: params.source,
    site: 'step-report',
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'gate', 'success'],
    invalidCode: 'invalid-step-gate-success',
    invalidMessage: 'Step gate success must be a valid CEL boolean expression.',
    issues: params.issues,
  });
}
