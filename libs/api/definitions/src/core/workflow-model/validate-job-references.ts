import {
  analyzeContextRootKeyAccess,
  type WorkflowExpression,
  type WorkflowInterpolationField,
  type WorkflowPredicateField,
} from '@shipfox/expression';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export function validateDirectJobReferences(params: {
  source: string;
  expression: WorkflowExpression;
  field: WorkflowInterpolationField | WorkflowPredicateField;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  allowedJobReferences: ReadonlySet<string>;
}): WorkflowModelValidationIssue | undefined {
  const access = analyzeContextRootKeyAccess(params.expression, ['jobs']);
  const [computed] = access.violations;
  if (computed !== undefined) {
    return issue({
      code: 'computed-context-key',
      message: `${fieldLabel(params.field)} must reference jobs with a literal dot key.`,
      path: params.path,
      details: {
        field: params.field,
        source: params.source,
        expression: computed.source,
        contextRoots: ['jobs'],
      },
    });
  }

  const missing = access.references.find(
    (reference) => !params.allowedJobReferences.has(reference.key),
  );
  if (missing === undefined) return undefined;

  return issue({
    code: 'missing-job-needs-edge',
    message: `${fieldLabel(params.field)} references job "${missing.key}" without a direct needs edge.`,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      expression: params.expression.source,
      job: missing.key,
      allowedJobs: [...params.allowedJobReferences],
    },
  });
}

function fieldLabel(field: WorkflowInterpolationField | WorkflowPredicateField): string {
  switch (field) {
    case 'run':
      return 'Run command interpolation';
    case 'env.value':
      return 'Env value interpolation';
    case 'agent.prompt':
      return 'Agent prompt interpolation';
    case 'agent.model':
      return 'Agent model interpolation';
    case 'agent.provider':
      return 'Agent provider interpolation';
    case 'agent.thinking':
      return 'Agent thinking interpolation';
    case 'job.runner':
      return 'Job runner interpolation';
    case 'job.outputs':
      return 'Job outputs mapping';
    case 'job.name':
      return 'Job name interpolation';
    case 'step.name':
      return 'Step name interpolation';
    case 'step.success':
      return 'Step gate success';
    case 'step.feedback':
      return 'Step feedback';
    case 'job.success':
      return 'Job success';
    default:
      return assertNever(field);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workflow field: ${value}`);
}
