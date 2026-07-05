import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';

export const DEFAULT_JOB_SUCCESS = "!executions.exists(e, e.status == 'failed')";

export function normalizeJobSuccess(params: {
  source: string | undefined;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
}): string | undefined {
  if (params.source === undefined) return undefined;

  const expression = validatePredicateExpression({
    field: 'job.success',
    source: params.source,
    site: 'job-resolution',
    path: ['jobs', params.sourceName, 'success'],
    invalidCode: 'invalid-job-success',
    invalidMessage: 'Job success must be a valid CEL boolean expression.',
    issues: params.issues,
    allowedJobReferences: params.allowedJobReferences,
  });
  return expression?.source;
}
