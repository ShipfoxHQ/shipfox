import type {JobStatus} from './entities/job.js';
import type {WorkflowRunStatus} from './entities/workflow-run.js';

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

export class AgentConfigUnresolvableError extends Error {
  constructor(
    readonly definitionId: string,
    options?: ErrorOptions | undefined,
  ) {
    super(`Agent configuration cannot be resolved for definition ${definitionId}`, options);
    this.name = 'AgentConfigUnresolvableError';
  }
}

/**
 * True when a `runWorkflow` failure can never succeed on retry: the definition is gone or
 * the subscription points at the wrong project. Callers (e.g. the trigger dispatcher) use this
 * to skip a permanently-broken target instead of retrying it forever. Every other failure is
 * treated as transient so at-least-once delivery can converge.
 */
export function isPermanentRunWorkflowError(error: unknown): boolean {
  return (
    error instanceof DefinitionNotFoundError ||
    error instanceof ProjectMismatchError ||
    error instanceof AgentConfigUnresolvableError
  );
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
    readonly status: JobStatus,
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

export class WorkflowRunNotCancellableError extends Error {
  constructor(
    readonly runId: string,
    readonly status: WorkflowRunStatus,
  ) {
    super(`Workflow run ${runId} is ${status} and cannot be cancelled`);
    this.name = 'WorkflowRunNotCancellableError';
  }
}

export class SourceRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Source workflow run not found: ${runId}`);
    this.name = 'SourceRunNotFoundError';
  }
}

export class RunNotTerminalError extends Error {
  constructor(runId: string) {
    super(`Workflow run is not terminal: ${runId}`);
    this.name = 'RunNotTerminalError';
  }
}

export class NoFailedJobsError extends Error {
  constructor(runId: string) {
    super(`Workflow run has no failed or cancelled jobs to re-run: ${runId}`);
    this.name = 'NoFailedJobsError';
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
