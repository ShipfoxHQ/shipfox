import {z} from 'zod';
import {jobStatusReasonSchema} from './schemas/job.js';
import {logOutcomeSchema} from './schemas/log-outcome.js';

const nonEmptyStringSchema = z.string().nonempty();

export const WORKFLOWS_WORKFLOW_RUN_CREATED = 'workflows.workflow_run.created' as const;
// Terminal fact for a workflow run, written in the same transaction as the status flip.
export const WORKFLOWS_WORKFLOW_RUN_TERMINATED = 'workflows.workflow_run.terminated' as const;
// Intent fact for cooperative run cancellation. Consumers use this to stop orchestration.
export const WORKFLOWS_WORKFLOW_RUN_CANCELLED = 'workflows.workflow_run.cancelled' as const;
export const WORKFLOWS_JOB_TIMED_OUT = 'workflows.job.timed_out' as const;
// Terminal fact for a job: the single reliable "this job is over" signal, written in
// the same transaction as the status flip, on every terminal path.
export const WORKFLOWS_JOB_TERMINATED = 'workflows.job.terminated' as const;
// Internal signal, not a terminal fact: a job's steps have all settled, so the
// on-job-steps-settled subscriber can raise the Temporal JOB_FINISHED_SIGNAL. Fires
// before the job row is terminal; observe WORKFLOWS_JOB_TERMINATED for the outcome.
export const WORKFLOWS_JOB_STEPS_SETTLED = 'workflows.job.steps_settled' as const;
// Written in the same transaction as a durable gate restart: the failed attempt
// plus the rewind of the projection from `restart_from`. The pull-based runner
// re-dispatches the rewound step on its next pull, so consumers must treat this
// at-least-once outbox event as idempotent audit data.
export const WORKFLOWS_STEP_RESTART_ENQUEUED = 'workflows.step.restart_enqueued' as const;
export const WORKFLOWS_STEP_ATTEMPT_TERMINATED = 'workflows.step_attempt.terminated' as const;

export const workflowsWorkflowRunCreatedSchema = z.object({
  runId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  definitionId: nonEmptyStringSchema,
});
export type WorkflowsWorkflowRunCreatedEvent = z.infer<typeof workflowsWorkflowRunCreatedSchema>;

// Keep outbox terminal statuses narrower than the public status schemas, which
// also carry pending/running and job-only skipped.
export const workflowRunTerminalStatusSchema = z.enum(['succeeded', 'failed', 'cancelled']);
export const jobTerminalStatusSchema = z.enum(['succeeded', 'failed', 'cancelled', 'skipped']);
export const terminalStatusSchema = workflowRunTerminalStatusSchema;

export const workflowsWorkflowRunTerminatedSchema = z.object({
  runId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  status: workflowRunTerminalStatusSchema,
});
export type WorkflowsWorkflowRunTerminatedEvent = z.infer<
  typeof workflowsWorkflowRunTerminatedSchema
>;

export const workflowsWorkflowRunCancelledSchema = z.object({
  runId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
});
export type WorkflowsWorkflowRunCancelledEvent = z.infer<
  typeof workflowsWorkflowRunCancelledSchema
>;

export const workflowsJobTimedOutSchema = z.object({
  jobId: nonEmptyStringSchema,
  executionId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
});
export type WorkflowsJobTimedOutEvent = z.infer<typeof workflowsJobTimedOutSchema>;

export const workflowsJobTerminatedSchema = z.object({
  jobId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  status: jobTerminalStatusSchema,
  statusReason: jobStatusReasonSchema.nullable(),
});
export type WorkflowsJobTerminatedEvent = z.infer<typeof workflowsJobTerminatedSchema>;

const settledStatusSchema = z.enum(['succeeded', 'failed']);

export const workflowsJobStepsSettledSchema = z.object({
  jobId: nonEmptyStringSchema,
  executionId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  status: settledStatusSchema,
});
export type WorkflowsJobStepsSettledEvent = z.infer<typeof workflowsJobStepsSettledSchema>;

export const workflowsStepRestartEnqueuedSchema = z.object({
  jobId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  failedStepId: nonEmptyStringSchema,
  failedStepAttempt: z.number(),
  restartFromStepId: nonEmptyStringSchema,
  reason: z.string(),
});
export type WorkflowsStepRestartEnqueuedEvent = z.infer<typeof workflowsStepRestartEnqueuedSchema>;

export const workflowsStepAttemptTerminatedSchema = z.object({
  jobId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  stepId: nonEmptyStringSchema,
  attempt: z.number().int().positive(),
  logOutcome: logOutcomeSchema,
});
export type WorkflowsStepAttemptTerminatedEvent = z.infer<
  typeof workflowsStepAttemptTerminatedSchema
>;

export interface WorkflowsEventMap {
  [WORKFLOWS_WORKFLOW_RUN_CREATED]: WorkflowsWorkflowRunCreatedEvent;
  [WORKFLOWS_WORKFLOW_RUN_TERMINATED]: WorkflowsWorkflowRunTerminatedEvent;
  [WORKFLOWS_WORKFLOW_RUN_CANCELLED]: WorkflowsWorkflowRunCancelledEvent;
  [WORKFLOWS_JOB_TIMED_OUT]: WorkflowsJobTimedOutEvent;
  [WORKFLOWS_JOB_TERMINATED]: WorkflowsJobTerminatedEvent;
  [WORKFLOWS_JOB_STEPS_SETTLED]: WorkflowsJobStepsSettledEvent;
  [WORKFLOWS_STEP_RESTART_ENQUEUED]: WorkflowsStepRestartEnqueuedEvent;
  [WORKFLOWS_STEP_ATTEMPT_TERMINATED]: WorkflowsStepAttemptTerminatedEvent;
}

export const workflowsEventSchemas = {
  [WORKFLOWS_WORKFLOW_RUN_CREATED]: workflowsWorkflowRunCreatedSchema,
  [WORKFLOWS_WORKFLOW_RUN_TERMINATED]: workflowsWorkflowRunTerminatedSchema,
  [WORKFLOWS_WORKFLOW_RUN_CANCELLED]: workflowsWorkflowRunCancelledSchema,
  [WORKFLOWS_JOB_TIMED_OUT]: workflowsJobTimedOutSchema,
  [WORKFLOWS_JOB_TERMINATED]: workflowsJobTerminatedSchema,
  [WORKFLOWS_JOB_STEPS_SETTLED]: workflowsJobStepsSettledSchema,
  [WORKFLOWS_STEP_RESTART_ENQUEUED]: workflowsStepRestartEnqueuedSchema,
  [WORKFLOWS_STEP_ATTEMPT_TERMINATED]: workflowsStepAttemptTerminatedSchema,
} satisfies Record<keyof WorkflowsEventMap, z.ZodType>;
