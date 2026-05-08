export const WORKFLOW_RUN_CREATED = 'workflows.run.created' as const;
export const WORKFLOW_RUN_FINISHED = 'workflows.run.finished' as const;
export const WORKFLOWS_JOB_TIMED_OUT = 'workflows.job.timed_out' as const;

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

export interface WorkflowsEventMap {
  [WORKFLOW_RUN_CREATED]: WorkflowRunCreatedEvent;
  [WORKFLOW_RUN_FINISHED]: WorkflowRunFinishedEvent;
  [WORKFLOWS_JOB_TIMED_OUT]: WorkflowsJobTimedOutEvent;
}
