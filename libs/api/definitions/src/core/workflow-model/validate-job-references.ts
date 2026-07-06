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
import {workflowFieldLabel} from './workflow-field-label.js';

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
      message: `${workflowFieldLabel(params.field)} must reference jobs with a literal dot key.`,
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
    message: `${workflowFieldLabel(params.field)} references job "${missing.key}" without a direct needs edge.`,
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
