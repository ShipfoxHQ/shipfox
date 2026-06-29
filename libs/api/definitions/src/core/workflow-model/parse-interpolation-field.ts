import {
  createWorkflowExpression,
  type ExpressionTypeEnvironment,
  getWorkflowContextDefinition,
  getWorkflowContextTypeEnvironment,
  InvalidWorkflowExpressionError,
  InvalidWorkflowTemplateError,
  parseWorkflowTemplate,
  type WorkflowContextName,
  type WorkflowInterpolationField,
  type WorkflowTemplateExprSegment,
  type WorkflowTemplateSegment,
  workflowContextNames,
  workflowInterpolationFieldAcceptsContext,
} from '@shipfox/expression';
import type {WorkflowFieldTemplate} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssueCode,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';

export type StoredInterpolationField = 'run' | 'env.value' | 'agent.prompt' | 'step.name';
export type UnsupportedInterpolationField = 'agent.model' | 'agent.provider';

export function parseInterpolationField(params: {
  field: StoredInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
}): WorkflowFieldTemplate | undefined {
  const segments = parseTemplate(params);
  if (segments === undefined) return undefined;

  const expressionSegments = segments.filter(isExpressionSegment);
  if (expressionSegments.length === 0) return undefined;

  const checkedSegments = segments.map((segment) => {
    if (segment.kind === 'literal') return segment;

    const validatedSegment = validateExpressionSegment({...params, segment});
    return validatedSegment ?? segment;
  });

  return checkedSegments;
}

export function rejectUnsupportedInterpolationField(params: {
  field: UnsupportedInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
}): boolean {
  const segments = parseTemplate(params);
  if (segments === undefined) return true;
  if (!segments.some(isExpressionSegment)) return false;

  const contextRoots = uniqueStrings(
    segments.filter(isExpressionSegment).flatMap((segment) => segment.contextRoots),
  );
  const knownRoots = contextRoots.filter(isWorkflowContextName);
  const unknownRoots = contextRoots.filter((root) => !isWorkflowContextName(root));
  if (unknownRoots.length > 0) {
    params.issues.push(
      issue({
        code: 'unknown-interpolation-context',
        message: `${fieldLabel(params.field)} interpolation references unknown context ${formatList(
          unknownRoots,
        )}.`,
        path: params.path,
        details: {field: params.field, source: params.source, contextRoots, unknownRoots},
      }),
    );
    return true;
  }

  const rejectedRoots = knownRoots.filter(
    (root) => !workflowInterpolationFieldAcceptsContext(params.field, root),
  );
  if (rejectedRoots.length > 0) {
    params.issues.push(untrustedContextIssue({...params, contextRoots, rejectedRoots}));
    return true;
  }

  params.issues.push(
    issue({
      code: 'interpolation-not-supported',
      message: `${fieldLabel(
        params.field,
      )} interpolation is not supported until run-creation interpolation resolution lands in ENG-637.`,
      path: params.path,
      details: {field: params.field, source: params.source, contextRoots},
    }),
  );
  return true;
}

function parseTemplate(params: {
  field: WorkflowInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
}): WorkflowTemplateSegment[] | undefined {
  try {
    return parseWorkflowTemplate(params.source);
  } catch (error) {
    params.issues.push(
      issue({
        code: 'invalid-interpolation-template',
        message: `${fieldLabel(params.field)} must use valid $${'{{ }}'} interpolation syntax.`,
        path: params.path,
        details: {
          field: params.field,
          source: params.source,
          reason:
            error instanceof InvalidWorkflowTemplateError
              ? error.reason
              : 'Template source did not parse.',
        },
      }),
    );
    return undefined;
  }
}

function validateExpressionSegment(params: {
  field: StoredInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  segment: WorkflowTemplateExprSegment;
}): WorkflowTemplateExprSegment | undefined {
  const contextRoots = uniqueStrings(params.segment.contextRoots);
  const knownRoots = contextRoots.filter(isWorkflowContextName);
  const unknownRoots = contextRoots.filter((root) => !isWorkflowContextName(root));

  if (unknownRoots.length > 0) {
    params.issues.push(
      issue({
        code: 'unknown-interpolation-context',
        message: `${fieldLabel(params.field)} interpolation references unknown context ${formatList(
          unknownRoots,
        )}.`,
        path: params.path,
        details: {
          field: params.field,
          source: params.source,
          expression: params.segment.expression.source,
          contextRoots,
          unknownRoots,
        },
      }),
    );
    return undefined;
  }

  const rejectedRoots = knownRoots.filter(
    (root) => !workflowInterpolationFieldAcceptsContext(params.field, root),
  );
  if (rejectedRoots.length > 0) {
    params.issues.push(untrustedContextIssue({...params, contextRoots, rejectedRoots}));
    return undefined;
  }

  if (knownRoots.length === 0 || knownRoots.some((root) => hasSyntaxOnlyCheckMode(root))) {
    return params.segment;
  }

  try {
    return {
      ...params.segment,
      expression: createWorkflowExpression({
        source: params.segment.expression.source,
        check: {
          mode: 'typed',
          typeEnvironment: mergeTypeEnvironments(knownRoots),
        },
      }),
    };
  } catch (error) {
    params.issues.push(
      issue({
        code: 'invalid-interpolation-expression',
        message: `${fieldLabel(params.field)} interpolation expression did not type-check.`,
        path: params.path,
        details: {
          field: params.field,
          source: params.source,
          expression: params.segment.expression.source,
          contextRoots,
          reason:
            error instanceof InvalidWorkflowExpressionError
              ? error.reason
              : 'Expression source did not type-check.',
        },
      }),
    );
    return undefined;
  }
}

function untrustedContextIssue(params: {
  field: WorkflowInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
  rejectedRoots: readonly WorkflowContextName[];
}): WorkflowModelValidationIssue {
  return issue({
    code: 'untrusted-context-in-field',
    message:
      params.field === 'run'
        ? `Run command interpolation cannot use untrusted context ${formatList(
            params.rejectedRoots,
          )}. Bind untrusted values to env and reference the shell variable from run instead.`
        : `${fieldLabel(params.field)} interpolation cannot use untrusted context ${formatList(
            params.rejectedRoots,
          )}.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      contextRoots: params.contextRoots,
      rejectedRoots: params.rejectedRoots,
    },
  });
}

function hasSyntaxOnlyCheckMode(root: WorkflowContextName): boolean {
  return getWorkflowContextDefinition(root).checkMode === 'syntax';
}

function mergeTypeEnvironments(roots: readonly WorkflowContextName[]): ExpressionTypeEnvironment {
  const typeEnvironment: Record<string, ExpressionTypeEnvironment[string]> = {};

  for (const root of roots) {
    const contextTypeEnvironment = getWorkflowContextTypeEnvironment(root);
    if (contextTypeEnvironment === undefined) continue;

    Object.assign(typeEnvironment, contextTypeEnvironment);
  }

  return typeEnvironment;
}

function isExpressionSegment(
  segment: WorkflowTemplateSegment,
): segment is WorkflowTemplateExprSegment {
  return segment.kind === 'expr';
}

function isWorkflowContextName(root: string): root is WorkflowContextName {
  return (workflowContextNames as readonly string[]).includes(root);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function formatList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}

function fieldLabel(field: WorkflowInterpolationField): string {
  return `Workflow ${field}`;
}

function issue(params: {
  code: WorkflowModelValidationIssueCode;
  message: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  details?: Readonly<Record<string, unknown>>;
}): WorkflowModelValidationIssue {
  if (params.details === undefined) {
    return {
      code: params.code,
      message: params.message,
      path: params.path,
    };
  }

  return {
    code: params.code,
    message: params.message,
    path: params.path,
    details: params.details,
  };
}
