export const invalidWorkflowTemplateErrorCode = 'invalid-workflow-template';

export class InvalidWorkflowTemplateError extends Error {
  readonly code = invalidWorkflowTemplateErrorCode;
  readonly source: string;
  readonly reason: string;
  readonly offset: number;

  constructor(params: {source: string; reason: string; offset: number; cause?: unknown}) {
    super('Invalid workflow template', {cause: params.cause});
    this.name = 'InvalidWorkflowTemplateError';
    this.source = params.source;
    this.reason = params.reason;
    this.offset = params.offset;
  }
}
