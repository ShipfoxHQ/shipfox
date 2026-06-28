export const invalidWorkflowModelErrorCode = 'invalid-workflow-model';

export type WorkflowModelValidationIssueCode =
  | 'duplicate-job-id'
  | 'duplicate-step-id'
  | 'duplicate-trigger-id'
  | 'invalid-agent-model'
  | 'invalid-agent-provider'
  | 'invalid-agent-provider-model'
  | 'invalid-runner-label'
  | 'invalid-step-gate-restart-from'
  | 'invalid-step-gate-success-if'
  | 'job-dependency-cycle'
  | 'missing-runner-label'
  | 'multiple-manual-triggers'
  | 'self-job-dependency'
  | 'too-many-runner-labels'
  | 'unknown-job-dependency';

export type WorkflowModelValidationIssuePathSegment = string | number;

export interface WorkflowModelValidationIssue {
  readonly code: WorkflowModelValidationIssueCode;
  readonly message: string;
  readonly path: readonly WorkflowModelValidationIssuePathSegment[];
  readonly details?: Readonly<Record<string, unknown>>;
}

export class InvalidWorkflowModelError extends Error {
  readonly code = invalidWorkflowModelErrorCode;

  constructor(readonly issues: readonly WorkflowModelValidationIssue[]) {
    super('Invalid workflow model');
    this.name = 'InvalidWorkflowModelError';
  }
}
