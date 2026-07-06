export const invalidWorkflowModelErrorCode = 'invalid-workflow-model';

export type WorkflowModelValidationIssueCode =
  | 'context-unavailable-at-fill-site'
  | 'context-unavailable-at-predicate-site'
  | 'computed-context-key'
  | 'duplicate-job-id'
  | 'duplicate-step-id'
  | 'duplicate-trigger-id'
  | 'harness-provider-incompatible'
  | 'harness-thinking-incompatible'
  | 'invalid-cron-event'
  | 'invalid-cron-schedule'
  | 'invalid-cron-timezone'
  | 'invalid-provider'
  | 'invalid-trigger-filter'
  | 'invalid-interpolation-expression'
  | 'invalid-interpolation-template'
  | 'invalid-duration'
  | 'invalid-listener-filter'
  | 'invalid-job-output'
  | 'invalid-job-success'
  | 'invalid-output-schema'
  | 'invalid-runner-label'
  | 'invalid-step-gate-restart-from'
  | 'invalid-step-gate-success'
  | 'job-dependency-cycle'
  | 'listening-job-missing-resolution-source'
  | 'listening-timeout-exceeds-run-timeout'
  | 'missing-job-needs-edge'
  | 'missing-cron-schedule'
  | 'missing-runner-label'
  | 'multiple-manual-triggers'
  | 'runner-context-not-bare'
  | 'runner-context-in-field'
  | 'runner-context-in-server-predicate'
  | 'self-job-dependency'
  | 'too-many-runner-labels'
  | 'unknown-secret-store'
  | 'unknown-interpolation-context'
  | 'unknown-job-dependency'
  | 'untrusted-context-in-field'
  | 'vars-context-in-server-predicate';

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
