export const WORKFLOW_RUN_CREATED = 'workflows.run.created' as const;
export const WORKFLOW_RUN_FINISHED = 'workflows.run.finished' as const;
export const WORKFLOWS_JOB_TIMED_OUT = 'workflows.job.timed_out' as const;
// Written in the same transaction as the final per-step result that makes a job
// terminal, so per-step execution signals job completion exactly once (the
// at-least-once outbox + workflow-side signal dedupe make it safe).
export const WORKFLOWS_JOB_COMPLETED = 'workflows.job.completed' as const;
// Written in the same transaction as a durable gate restart (the failed attempt
// + the rewind of the projection from `restart_from`), as a durable audit record
// of the restart. The pull-based runner re-dispatches the rewound step on its
// next pull, so this event is not required to advance execution. Audit-only for
// now; any future consumer must be idempotent (the outbox is at-least-once).
export const WORKFLOWS_STEP_RESTART_ENQUEUED = 'workflows.step.restart_enqueued' as const;

export interface WorkflowRunCreatedEvent {
  runId: string;
  workspaceId: string;
  projectId: string;
  definitionId: string;
}

export interface WorkflowRunFinishedEvent {
  runId: string;
  projectId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
}

export interface WorkflowsJobTimedOutEvent {
  jobId: string;
  runId: string;
}

export interface WorkflowsJobCompletedEvent {
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
  [WORKFLOW_RUN_CREATED]: WorkflowRunCreatedEvent;
  [WORKFLOW_RUN_FINISHED]: WorkflowRunFinishedEvent;
  [WORKFLOWS_JOB_TIMED_OUT]: WorkflowsJobTimedOutEvent;
  [WORKFLOWS_JOB_COMPLETED]: WorkflowsJobCompletedEvent;
  [WORKFLOWS_STEP_RESTART_ENQUEUED]: WorkflowsStepRestartEnqueuedEvent;
}
