import {
  type AvailabilitySite,
  createWorkflowExpression,
  type ExpressionTypeEnvironment,
  extractCelUntrustedPathAccesses,
  getWorkflowContextAvailability,
  getWorkflowContextDefinition,
  getWorkflowContextTypeEnvironment,
  getWorkflowContextUntrustedPaths,
  InvalidWorkflowExpressionError,
  InvalidWorkflowTemplateError,
  parseWorkflowTemplate,
  unavailableRootsAt,
  type WorkflowContextName,
  type WorkflowInterpolationField,
  type WorkflowTemplateExprSegment,
  type WorkflowTemplateSegment,
  workflowContextNames,
  workflowInterpolationFieldAcceptsContext,
  workflowInterpolationFieldAcceptsTrustTier,
} from '@shipfox/expression';
import type {WorkflowFieldTemplate} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssueCode,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';

export type StoredInterpolationField =
  | 'run'
  | 'env.value'
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'job.name'
  | 'step.name';

export function parseInterpolationField(params: {
  field: StoredInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  fillSite?: AvailabilitySite;
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
  fillSite?: AvailabilitySite;
}): WorkflowTemplateExprSegment | undefined {
  const contextRoots = uniqueStrings(params.segment.contextRoots);
  const knownRoots = contextRoots.filter(isWorkflowContextName);
  const unknownRoots = contextRoots.filter((root) => !isWorkflowContextName(root));

  const rejectedRoots = knownRoots.filter(
    (root) => !workflowInterpolationFieldAcceptsContext(params.field, root),
  );
  if (rejectedRoots.length > 0) {
    params.issues.push(untrustedContextIssue({...params, contextRoots, rejectedRoots}));
    return undefined;
  }

  const rejectedPathRoots = findUntrustedPathRoots(params.segment, params.field, knownRoots);
  if (rejectedPathRoots.length > 0) {
    params.issues.push(
      untrustedContextIssue({...params, contextRoots, rejectedRoots: rejectedPathRoots}),
    );
    return undefined;
  }

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

  const fillSite = params.fillSite;
  if (fillSite !== undefined) {
    const unavailableRoots = unavailableRootsAt(knownRoots, fillSite);
    if (unavailableRoots.length > 0) {
      params.issues.push(
        unavailableContextIssue({...params, contextRoots, unavailableRoots, fillSite}),
      );
      return undefined;
    }
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

function findUntrustedPathRoots(
  segment: WorkflowTemplateExprSegment,
  field: StoredInterpolationField,
  knownRoots: readonly WorkflowContextName[],
): readonly WorkflowContextName[] {
  if (!isTrustedOnlyField(field)) return [];

  const untrustedPathsByRoot = new Map<string, readonly string[]>();
  for (const root of knownRoots) {
    const paths = getWorkflowContextUntrustedPaths(root);
    if (paths === undefined || paths.length === 0) continue;
    untrustedPathsByRoot.set(root, paths);
  }
  if (untrustedPathsByRoot.size === 0) return [];

  return extractCelUntrustedPathAccesses({
    source: segment.expression.source,
    untrustedPathsByRoot,
  }).filter(isWorkflowContextName);
}

function isTrustedOnlyField(field: StoredInterpolationField): boolean {
  return !workflowInterpolationFieldAcceptsTrustTier(field, 'untrusted');
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

const availabilitySiteLabels = {
  ingest: 'ingest',
  'run-creation': 'run creation',
  'execution-creation': 'execution creation',
  'job-activation': 'job activation',
  'step-dispatch': 'step dispatch',
  'step-report': 'step reporting',
  'execution-resolution': 'execution resolution',
  'job-resolution': 'job resolution',
} as const satisfies Record<AvailabilitySite, string>;

function unavailableContextIssue(params: {
  field: WorkflowInterpolationField;
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  segment: WorkflowTemplateExprSegment;
  contextRoots: readonly string[];
  unavailableRoots: readonly WorkflowContextName[];
  fillSite: AvailabilitySite;
}): WorkflowModelValidationIssue {
  return issue({
    code: 'context-unavailable-at-fill-site',
    message: `${fieldLabel(params.field)} interpolation references context ${params.unavailableRoots
      .map((root) => unavailableRootMessage(root, params.fillSite))
      .join(' ')}`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      expression: params.segment.expression.source,
      contextRoots: params.contextRoots,
      unavailableRoots: params.unavailableRoots,
      fillSite: params.fillSite,
    },
  });
}

function unavailableRootMessage(root: WorkflowContextName, fillSite: AvailabilitySite): string {
  return `"${root}" is not available at ${describeAvailabilitySite(
    fillSite,
  )}; it becomes available at ${describeAvailabilitySite(getWorkflowContextAvailability(root))}.`;
}

function describeAvailabilitySite(site: AvailabilitySite): string {
  return availabilitySiteLabels[site];
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
