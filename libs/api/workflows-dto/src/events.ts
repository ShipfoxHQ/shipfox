export const WORKFLOWS_WORKFLOW_RUN_CREATED = 'workflows.workflow_run.created' as const;
// Public terminal fact for a workflow run: written in the same transaction that
// flips the run's status to a terminal value (succeeded/failed/cancelled).
export const WORKFLOWS_WORKFLOW_RUN_TERMINATED = 'workflows.workflow_run.terminated' as const;
export const WORKFLOWS_JOB_TIMED_OUT = 'workflows.job.timed_out' as const;
// Public terminal fact for a job, and the single reliable "this job is over"
// signal: written in the same transaction that flips the job's status to a terminal
// value (succeeded/failed/cancelled), across every terminal path — normal
// completion, DAG cancellation, lease-expiry resolution, and the timeout backstop.
export const WORKFLOWS_JOB_TERMINATED = 'workflows.job.terminated' as const;
// Internal orchestration signal, NOT a terminal fact: all of a job's steps have
// settled into terminal states. Written in the same transaction as the final
// per-step result (before the job row itself is terminal), succeeded/failed only;
// the `on-job-steps-settled` subscriber raises the Temporal JOB_FINISHED_SIGNAL so
// the workflow finalizes the job. Use WORKFLOWS_JOB_TERMINATED to observe the job's
// outcome.
export const WORKFLOWS_JOB_STEPS_SETTLED = 'workflows.job.steps_settled' as const;
// Written in the same transaction as a durable gate restart (the failed attempt
// + the rewind of the projection from `restart_from`), as a durable audit record
// of the restart. The pull-based runner re-dispatches the rewound step on its
// next pull, so this event is not required to advance execution. Audit-only for
// now; any future consumer must be idempotent (the outbox is at-least-once).
export const WORKFLOWS_STEP_RESTART_ENQUEUED = 'workflows.step.restart_enqueued' as const;

export interface WorkflowsWorkflowRunCreatedEvent {
  runId: string;
  workspaceId: string;
  projectId: string;
  definitionId: string;
}

export interface WorkflowsWorkflowRunTerminatedEvent {
  runId: string;
  projectId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
}

export interface WorkflowsJobTimedOutEvent {
  jobId: string;
  runId: string;
}

export interface WorkflowsJobTerminatedEvent {
  jobId: string;
  runId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
}

export interface WorkflowsJobStepsSettledEvent {
  jobId: string;
  runId: string;
  status: 'succeeded' | 'failed';
}

export interface WorkflowsStepRestartEnqueuedEvent {
  jobId: string;
  runId: string;
  failedStepId: string;
  failedStepAttempt: number;
  restartFromStepId: string;
  reason: string;
}

export interface WorkflowsEventMap {
  [WORKFLOWS_WORKFLOW_RUN_CREATED]: WorkflowsWorkflowRunCreatedEvent;
  [WORKFLOWS_WORKFLOW_RUN_TERMINATED]: WorkflowsWorkflowRunTerminatedEvent;
  [WORKFLOWS_JOB_TIMED_OUT]: WorkflowsJobTimedOutEvent;
  [WORKFLOWS_JOB_TERMINATED]: WorkflowsJobTerminatedEvent;
  [WORKFLOWS_JOB_STEPS_SETTLED]: WorkflowsJobStepsSettledEvent;
  [WORKFLOWS_STEP_RESTART_ENQUEUED]: WorkflowsStepRestartEnqueuedEvent;
}
