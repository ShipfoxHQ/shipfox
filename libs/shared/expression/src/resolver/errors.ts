export const workflowTemplateResolutionErrorCode = 'workflow-template-resolution-failed';

export class WorkflowTemplateResolutionError extends Error {
  readonly code = workflowTemplateResolutionErrorCode;
  readonly source: string;

  constructor(params: {source: string; cause: unknown}) {
    super('Workflow template resolution failed', {cause: params.cause});
    this.name = 'WorkflowTemplateResolutionError';
    this.source = params.source;
  }
}
