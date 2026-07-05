import {
  type AvailabilitySite,
  availabilitySites,
  createWorkflowExpression,
  type ExpressionTypeEnvironment,
  extractExactContextRoots,
  getWorkflowContextDefinition,
  getWorkflowContextTypeEnvironment,
  InvalidWorkflowExpressionError,
  resolveContextRootAvailability,
  resolveContextRootHost,
  validateServerEvaluable,
  type WorkflowContextName,
  type WorkflowExpression,
  type WorkflowPredicateField,
  workflowContextNames,
} from '@shipfox/expression';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssueCode,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export function validatePredicateExpression(params: {
  field: WorkflowPredicateField;
  source: string;
  site: AvailabilitySite;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  invalidCode: WorkflowModelValidationIssueCode;
  invalidMessage: string;
  issues: WorkflowModelValidationIssue[];
}): WorkflowExpression | undefined {
  const syntaxExpression = createSyntaxExpression(params);
  if (syntaxExpression === undefined) return undefined;

  const contextRoots = extractExactContextRoots(syntaxExpression.source);
  const knownRoots = contextRoots.filter((root) => resolveContextRootHost(root) !== undefined);
  const unknownRoots = contextRoots.filter((root) => resolveContextRootHost(root) === undefined);

  if (unknownRoots.length > 0) {
    params.issues.push(invalidPredicateIssue({...params, contextRoots}));
    return undefined;
  }

  const serverEvaluability = validateServerEvaluable(syntaxExpression);
  if (!serverEvaluability.ok) {
    params.issues.push(
      ...serverEvaluability.violations.map((violation) =>
        runnerContextInServerPredicateIssue({
          ...params,
          contextRoots,
          runnerRoots: violation.runnerRoots,
        }),
      ),
    );
    return undefined;
  }

  const varsRoots = knownRoots.filter((root) => root === 'vars');
  if (varsRoots.length > 0) {
    params.issues.push(varsContextInServerPredicateIssue({...params, contextRoots}));
    return undefined;
  }

  const unavailableRoots = knownRoots.filter((root) => !isRootAvailableAt(root, params.site));
  if (unavailableRoots.length > 0) {
    params.issues.push(
      unavailablePredicateContextIssue({...params, contextRoots, unavailableRoots}),
    );
    return undefined;
  }

  if (knownRoots.some((root) => hasSyntaxOnlyCheckMode(root))) {
    return syntaxExpression;
  }

  try {
    return createWorkflowExpression({
      source: params.source,
      check: {
        mode: 'typed',
        typeEnvironment: mergeTypeEnvironments(knownRoots),
        expectedResultType: 'bool',
      },
    });
  } catch (error) {
    params.issues.push(
      invalidPredicateIssue({
        ...params,
        contextRoots,
        reason:
          error instanceof InvalidWorkflowExpressionError
            ? error.reason
            : 'Expression source did not parse or type-check.',
      }),
    );
    return undefined;
  }
}

function createSyntaxExpression(params: {
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  invalidCode: WorkflowModelValidationIssueCode;
  invalidMessage: string;
  issues: WorkflowModelValidationIssue[];
}): WorkflowExpression | undefined {
  try {
    return createWorkflowExpression({
      source: params.source,
      check: {mode: 'syntax'},
    });
  } catch (error) {
    params.issues.push(
      invalidPredicateIssue({
        ...params,
        contextRoots: [],
        reason:
          error instanceof InvalidWorkflowExpressionError
            ? error.reason
            : 'Expression source did not parse or type-check.',
      }),
    );
    return undefined;
  }
}

function invalidPredicateIssue(params: {
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  invalidCode: WorkflowModelValidationIssueCode;
  invalidMessage: string;
  contextRoots: readonly string[];
  reason?: string;
}): WorkflowModelValidationIssue {
  return issue({
    code: params.invalidCode,
    message: params.invalidMessage,
    path: params.path,
    details: {
      source: params.source,
      contextRoots: params.contextRoots,
      reason: params.reason ?? 'Expression source did not parse or type-check.',
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

function runnerContextInServerPredicateIssue(params: {
  field: WorkflowPredicateField;
  source: string;
  site: AvailabilitySite;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
  runnerRoots: readonly string[];
}): WorkflowModelValidationIssue {
  return issue({
    code: 'runner-context-in-server-predicate',
    message: `${fieldLabel(params.field)} cannot reference runner context ${formatList(
      params.runnerRoots,
    )} because it is evaluated on the server at ${describeAvailabilitySite(params.site)}.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      contextRoots: params.contextRoots,
      runnerRoots: params.runnerRoots,
      site: params.site,
    },
  });
}

function varsContextInServerPredicateIssue(params: {
  field: WorkflowPredicateField;
  source: string;
  site: AvailabilitySite;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
}): WorkflowModelValidationIssue {
  return issue({
    code: 'vars-context-in-server-predicate',
    message: `${fieldLabel(params.field)} cannot reference vars because predicate evaluation does not include workflow variables.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      contextRoots: params.contextRoots,
      rejectedRoots: ['vars'],
      site: params.site,
    },
  });
}

function unavailablePredicateContextIssue(params: {
  field: WorkflowPredicateField;
  source: string;
  site: AvailabilitySite;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  contextRoots: readonly string[];
  unavailableRoots: readonly string[];
}): WorkflowModelValidationIssue {
  return issue({
    code: 'context-unavailable-at-predicate-site',
    message: `${fieldLabel(params.field)} references ${contextNoun(
      params.unavailableRoots,
    )} ${formatList(params.unavailableRoots)} that ${availabilityVerb(
      params.unavailableRoots,
    )} not available at ${describeAvailabilitySite(params.site)}. ${params.unavailableRoots
      .map(unavailableRootAvailabilityMessage)
      .join(' ')}`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      contextRoots: params.contextRoots,
      unavailableRoots: params.unavailableRoots,
      site: params.site,
    },
  });
}

function isRootAvailableAt(root: string, site: AvailabilitySite): boolean {
  const availability = resolveContextRootAvailability(root);
  if (availability === undefined) return false;

  return availabilitySites.indexOf(availability) <= availabilitySites.indexOf(site);
}

function unavailableRootAvailabilityMessage(root: string): string {
  const availability = resolveContextRootAvailability(root);
  if (availability === undefined) return `"${root}" is not available at any server site.`;
  return `"${root}" becomes available at ${describeAvailabilitySite(availability)}.`;
}

function hasSyntaxOnlyCheckMode(root: string): boolean {
  return isWorkflowContextName(root) && getWorkflowContextDefinition(root).checkMode === 'syntax';
}

function mergeTypeEnvironments(roots: readonly string[]): ExpressionTypeEnvironment {
  const typeEnvironment: Record<string, ExpressionTypeEnvironment[string]> = {};

  for (const root of roots) {
    if (!isWorkflowContextName(root)) continue;

    const contextTypeEnvironment = getWorkflowContextTypeEnvironment(root);
    if (contextTypeEnvironment === undefined) continue;

    Object.assign(typeEnvironment, contextTypeEnvironment);
  }

  return typeEnvironment;
}

function isWorkflowContextName(root: string): root is WorkflowContextName {
  return (workflowContextNames as readonly string[]).includes(root);
}

function fieldLabel(field: WorkflowPredicateField): string {
  return field === 'step.success' ? 'Step gate success' : 'Job success';
}

function contextNoun(roots: readonly string[]): 'context' | 'contexts' {
  return roots.length === 1 ? 'context' : 'contexts';
}

function availabilityVerb(roots: readonly string[]): 'is' | 'are' {
  return roots.length === 1 ? 'is' : 'are';
}

function describeAvailabilitySite(site: AvailabilitySite): string {
  return availabilitySiteLabels[site];
}

function formatList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}
