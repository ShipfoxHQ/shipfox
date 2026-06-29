export const workflowTemplateResolutionErrorCode = 'workflow-template-resolution-failed';

export class WorkflowTemplateResolutionError extends Error {
  readonly code = workflowTemplateResolutionErrorCode;
  readonly expression: string;

  constructor(params: {expression: string; cause: unknown}) {
    super('Workflow template resolution failed', {cause: params.cause});
    this.name = 'WorkflowTemplateResolutionError';
    this.expression = params.expression;
  }
}
