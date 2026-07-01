export const invalidWorkflowModelErrorCode = 'invalid-workflow-model';

export type WorkflowModelValidationIssueCode =
  | 'duplicate-job-id'
  | 'duplicate-step-id'
  | 'duplicate-trigger-id'
  | 'invalid-agent-provider'
  | 'invalid-interpolation-expression'
  | 'invalid-interpolation-template'
  | 'invalid-duration'
  | 'invalid-job-success'
  | 'invalid-runner-label'
  | 'invalid-step-gate-restart-from'
  | 'invalid-step-gate-success-if'
  | 'job-dependency-cycle'
  | 'listening-job-missing-resolution-source'
  | 'listening-timeout-exceeds-run-timeout'
  | 'missing-runner-label'
  | 'multiple-manual-triggers'
  | 'self-job-dependency'
  | 'too-many-runner-labels'
  | 'unknown-interpolation-context'
  | 'unknown-job-dependency'
  | 'untrusted-context-in-field';

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
