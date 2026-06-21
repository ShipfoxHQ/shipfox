import {z} from 'zod';

export const WORKFLOWS_WORKFLOW_RUN_CREATED = 'workflows.workflow_run.created' as const;
// Terminal fact for a workflow run, written in the same transaction as the status flip.
export const WORKFLOWS_WORKFLOW_RUN_TERMINATED = 'workflows.workflow_run.terminated' as const;
export const WORKFLOWS_JOB_TIMED_OUT = 'workflows.job.timed_out' as const;
// Terminal fact for a job: the single reliable "this job is over" signal, written in
// the same transaction as the status flip, on every terminal path.
export const WORKFLOWS_JOB_TERMINATED = 'workflows.job.terminated' as const;
// Internal signal, not a terminal fact: a job's steps have all settled, so the
// on-job-steps-settled subscriber can raise the Temporal JOB_FINISHED_SIGNAL. Fires
// before the job row is terminal; observe WORKFLOWS_JOB_TERMINATED for the outcome.
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

// Keep outbox terminal statuses narrower than runStatusSchema, which also
// carries pending/running.
export const terminalStatusSchema = z.enum(['succeeded', 'failed', 'cancelled']);

export const workflowsWorkflowRunTerminatedSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  status: terminalStatusSchema,
});
export type WorkflowsWorkflowRunTerminatedEvent = z.infer<
  typeof workflowsWorkflowRunTerminatedSchema
>;

export interface WorkflowsJobTimedOutEvent {
  jobId: string;
  runId: string;
}

export const workflowsJobTerminatedSchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  status: terminalStatusSchema,
});
export type WorkflowsJobTerminatedEvent = z.infer<typeof workflowsJobTerminatedSchema>;

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

export const workflowsEventSchemas = {
  [WORKFLOWS_WORKFLOW_RUN_TERMINATED]: workflowsWorkflowRunTerminatedSchema,
  [WORKFLOWS_JOB_TERMINATED]: workflowsJobTerminatedSchema,
};
