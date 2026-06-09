export const invalidWorkflowYamlErrorCode = 'invalid-workflow-yaml';

export type InvalidWorkflowYamlReason = 'syntax' | 'non-object-root';

export interface WorkflowYamlLocation {
  readonly line: number;
  readonly column: number;
}

export class InvalidWorkflowYamlError extends Error {
  readonly code = invalidWorkflowYamlErrorCode;
  readonly location: WorkflowYamlLocation | undefined;

  constructor(
    readonly reason: InvalidWorkflowYamlReason,
    message: string,
    options: {cause?: unknown; location?: WorkflowYamlLocation | undefined} = {},
  ) {
    super(message, {cause: options.cause});
    this.name = 'InvalidWorkflowYamlError';
    this.location = options.location;
  }
}
