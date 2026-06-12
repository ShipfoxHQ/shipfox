export class DefinitionNotFoundError extends Error {
  constructor(definitionId: string) {
    super(`Definition not found: ${definitionId}`);
    this.name = 'DefinitionNotFoundError';
  }
}

export class ProjectMismatchError extends Error {
  constructor(definitionProjectId: string, requestProjectId: string) {
    super(
      `Definition belongs to project ${definitionProjectId}, but request targets project ${requestProjectId}`,
    );
    this.name = 'ProjectMismatchError';
  }
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found or has no steps: ${jobId}`);
    this.name = 'JobNotFoundError';
  }
}

// The job named by a lease is terminal, so it must not exchange its lease for
// fresh checkout credentials. Server state is the final gate, not the token.
export class JobNotActiveError extends Error {
  constructor(
    readonly jobId: string,
    readonly status: string,
  ) {
    super(`Job ${jobId} is ${status} and cannot mint checkout credentials`);
    this.name = 'JobNotActiveError';
  }
}

export class WorkflowRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Workflow run not found: ${runId}`);
    this.name = 'WorkflowRunNotFoundError';
  }
}

// The run's project (and therefore its source repository) cannot be resolved, so
// there is nothing to check out.
export class CheckoutIntentUnresolvedError extends Error {
  constructor(projectId: string) {
    super(`Checkout intent unresolved: project ${projectId} not found`);
    this.name = 'CheckoutIntentUnresolvedError';
  }
}

export class StepNotFoundError extends Error {
  constructor(stepId: string, jobId: string) {
    super(`Step ${stepId} not found in job ${jobId}`);
    this.name = 'StepNotFoundError';
  }
}

export class StepNotRunningError extends Error {
  constructor(stepId: string, jobId: string) {
    super(`Step ${stepId} in job ${jobId} is not running and cannot accept a result`);
    this.name = 'StepNotRunningError';
  }
}

// A report whose attempt is ahead of the step's current attempt. The host
// allocates attempt numbers, so a runner can never report one it was not
// dispatched — this is a protocol error, not an idempotent no-op.
export class StepAttemptAheadError extends Error {
  constructor(
    readonly stepId: string,
    readonly jobId: string,
    readonly reportedAttempt: number,
    readonly currentAttempt: number,
  ) {
    super(
      `Step ${stepId} in job ${jobId} reported attempt ${reportedAttempt} ahead of current attempt ${currentAttempt}`,
    );
    this.name = 'StepAttemptAheadError';
  }
}
