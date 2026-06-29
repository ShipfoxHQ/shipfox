import {EvaluationError} from '@marcbachmann/cel-js';

export const workflowExpressionEvaluationErrorCode = 'workflow-expression-evaluation-failed';

export type WorkflowExpressionEvaluationFailureReason = 'missing-path' | 'evaluation-error';

export class WorkflowExpressionEvaluationError extends Error {
  readonly code = workflowExpressionEvaluationErrorCode;
  readonly reason: WorkflowExpressionEvaluationFailureReason;

  constructor(cause: unknown) {
    super('Workflow expression evaluation failed', {cause});
    this.name = 'WorkflowExpressionEvaluationError';
    this.reason =
      cause instanceof EvaluationError &&
      (cause.code === 'no_such_key' || cause.code === 'unknown_variable')
        ? 'missing-path'
        : 'evaluation-error';
  }
}
