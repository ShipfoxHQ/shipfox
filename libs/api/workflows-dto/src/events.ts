export const WORKFLOW_RUN_CREATED = 'workflows.run.created' as const;
export const WORKFLOW_RUN_FINISHED = 'workflows.run.finished' as const;
export const WORKFLOWS_JOB_TIMED_OUT = 'workflows.job.timed_out' as const;
// Written in the same transaction as the final per-step result that makes a job
// terminal, so per-step execution signals job completion exactly once (the
// at-least-once outbox + workflow-side signal dedupe make it safe).
export const WORKFLOWS_JOB_COMPLETED = 'workflows.job.completed' as const;

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

export interface WorkflowsEventMap {
  [WORKFLOW_RUN_CREATED]: WorkflowRunCreatedEvent;
  [WORKFLOW_RUN_FINISHED]: WorkflowRunFinishedEvent;
  [WORKFLOWS_JOB_TIMED_OUT]: WorkflowsJobTimedOutEvent;
  [WORKFLOWS_JOB_COMPLETED]: WorkflowsJobCompletedEvent;
}
