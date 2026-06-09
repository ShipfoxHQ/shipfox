export const invalidWorkflowExpressionErrorCode = 'invalid-workflow-expression';

export class InvalidWorkflowExpressionError extends Error {
  readonly code = invalidWorkflowExpressionErrorCode;
  readonly source: string;
  readonly reason: string;

  constructor(params: {source: string; reason: string; cause?: unknown}) {
    super('Invalid workflow expression', {cause: params.cause});
    this.name = 'InvalidWorkflowExpressionError';
    this.source = params.source;
    this.reason = params.reason;
  }
}
