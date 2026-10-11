import type {
  ExpressionTypeEnvironment,
  WorkflowExpression,
  WorkflowStepKind,
} from '@shipfox/expression';
import {
  WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS,
  type WorkflowDocumentGateFailureRule,
  type WorkflowDocumentStep,
} from '@shipfox/workflow-document';
import type {
  WorkflowModelStepFailureAction,
  WorkflowModelStepGate,
} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';
import {issue} from './validation-issue.js';

export function normalizeStepGate(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  stepId: string;
  previousStepKeys: ReadonlySet<string>;
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  stepKind?: WorkflowStepKind | undefined;
}): WorkflowModelStepGate | undefined {
  const gate = params.step.gate;
  if (gate === undefined) return undefined;

  const success = normalizeGateSuccess({
    source: gate.success,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
    stepKind: params.stepKind,
  });
  const onFailure =
    gate.on_failure === undefined
      ? undefined
      : normalizeFailureRules({
          rules: Array.isArray(gate.on_failure) ? gate.on_failure : [gate.on_failure],
          isList: Array.isArray(gate.on_failure),
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'gate', 'on_failure'],
          stepId: params.stepId,
          previousStepKeys: params.previousStepKeys,
          issues: params.issues,
          allowedJobReferences: params.allowedJobReferences,
          typeOverlay: params.typeOverlay,
          stepKind: params.stepKind,
        });

  if (success === undefined && onFailure === undefined) return undefined;

  return {
    ...(success === undefined ? {} : {success}),
    ...(onFailure === undefined ? {} : {onFailure}),
  };
}

function normalizeFailureRules(params: {
  rules: readonly WorkflowDocumentGateFailureRule[];
  isList: boolean;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  stepId: string;
  previousStepKeys: ReadonlySet<string>;
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  stepKind?: WorkflowStepKind | undefined;
}): WorkflowModelStepFailureAction[] {
  return params.rules.map((rule, index) => {
    const rulePath = params.isList ? [...params.path, index] : params.path;
    if (rule.if === undefined && index < params.rules.length - 1) {
      params.issues.push(
        issue({
          code: 'unreachable-step-gate-rule',
          message: `Step "${params.stepId}" has a restart rule with no "if" before the last rule. The rules after it can never apply.`,
          path: rulePath,
          details: {stepId: params.stepId, rule: index + 1},
        }),
      );
    }
    return normalizeFailureRule({...params, rule, rulePath});
  });
}

function normalizeFailureRule(params: {
  rule: WorkflowDocumentGateFailureRule;
  rulePath: readonly WorkflowModelValidationIssuePathSegment[];
  stepId: string;
  previousStepKeys: ReadonlySet<string>;
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  stepKind?: WorkflowStepKind | undefined;
}): WorkflowModelStepFailureAction {
  const {rule, rulePath} = params;
  if (!params.previousStepKeys.has(rule.restart_from)) {
    params.issues.push(
      issue({
        code: 'invalid-step-gate-restart-from',
        message: `Step "${params.stepId}" must restart from an earlier keyed step; found "${rule.restart_from}".`,
        path: rulePath,
        details: {stepId: params.stepId, restartFrom: rule.restart_from},
      }),
    );
  }

  const condition =
    rule.if === undefined
      ? undefined
      : validatePredicateExpression({
          field: 'step.success',
          source: rule.if,
          path: [...rulePath, 'if'],
          invalidCode: 'invalid-step-gate-rule-condition',
          invalidMessage: 'Step gate restart rule "if" must be a valid CEL boolean expression.',
          issues: params.issues,
          allowedJobReferences: params.allowedJobReferences,
          typeOverlay: params.typeOverlay,
          stepKind: params.stepKind,
        });
  const feedbackTemplate =
    rule.feedback === undefined
      ? undefined
      : parseInterpolationField({
          field: 'step.feedback',
          source: rule.feedback,
          path: rulePath,
          issues: params.issues,
          fillSite: 'step-report',
          typeOverlay: params.typeOverlay,
        });

  return {
    ...(condition === undefined ? {} : {if: condition}),
    restartFrom: rule.restart_from,
    ...(rule.feedback === undefined ? {} : {feedback: rule.feedback}),
    ...(feedbackTemplate === undefined ? {} : {feedbackTemplate}),
    maxAttempts: rule.max_attempts ?? WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS,
  };
}

function normalizeGateSuccess(params: {
  source: string | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  stepKind?: WorkflowStepKind | undefined;
}): WorkflowExpression | undefined {
  if (params.source === undefined) return undefined;

  return validatePredicateExpression({
    field: 'step.success',
    source: params.source,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'gate', 'success'],
    invalidCode: 'invalid-step-gate-success',
    invalidMessage: 'Step gate success must be a valid CEL boolean expression.',
    issues: params.issues,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
    stepKind: params.stepKind,
  });
}
