export const workflowExpressionEvaluationErrorCode = 'workflow-expression-evaluation-failed';

export class WorkflowExpressionEvaluationError extends Error {
  readonly code = workflowExpressionEvaluationErrorCode;

  constructor(cause: unknown) {
    super('Workflow expression evaluation failed', {cause});
    this.name = 'WorkflowExpressionEvaluationError';
  }
}
