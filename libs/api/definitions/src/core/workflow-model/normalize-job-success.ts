import {createWorkflowExpression, InvalidWorkflowExpressionError} from '@shipfox/expression';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export const DEFAULT_JOB_SUCCESS = 'executions.all(e, e.status == "succeeded")';

export function normalizeJobSuccess(params: {
  source: string | undefined;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
}): string | undefined {
  if (params.source === undefined) return undefined;

  try {
    createWorkflowExpression({
      source: params.source,
      check: {
        mode: 'typed',
        // Runtime success evaluation intentionally exposes only execution index/status today.
        typeEnvironment: {
          executions: {
            kind: 'list',
            element: {
              kind: 'object',
              fields: {
                index: 'int',
                status: 'string',
              },
            },
          },
        },
        expectedResultType: 'bool',
      },
    });
    return params.source;
  } catch (error) {
    params.issues.push(
      issue({
        code: 'invalid-job-success',
        message: 'Job success must be a valid CEL boolean expression.',
        path: ['jobs', params.sourceName, 'success'],
        details: {
          source: params.source,
          reason:
            error instanceof InvalidWorkflowExpressionError
              ? error.reason
              : 'Expression source did not parse or type-check.',
        },
      }),
    );
    return undefined;
  }
}
