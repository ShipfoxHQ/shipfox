import {z} from 'zod';
import {jobStatusReasonSchema} from './schemas/job.js';
import {logOutcomeSchema} from './schemas/log-outcome.js';

const nonEmptyStringSchema = z.string().nonempty();

export const WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED =
  'workflows.workflow_run_attempt.created' as const;
// Terminal fact for a workflow run, written in the same transaction as the status flip.
export const WORKFLOWS_WORKFLOW_RUN_TERMINATED = 'workflows.workflow_run.terminated' as const;
// Intent fact for cooperative run cancellation. Consumers use this to stop orchestration.
export const WORKFLOWS_WORKFLOW_RUN_CANCELLED = 'workflows.workflow_run.cancelled' as const;
export const WORKFLOWS_JOB_EXECUTION_TIMED_OUT = 'workflows.job_execution.timed_out' as const;
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
export const WORKFLOWS_JOB_EVENT_DELIVERED = 'workflows.job_event.delivered' as const;
export const WORKFLOWS_LISTENER_STARTED = 'workflows.listener.started' as const;
export const WORKFLOWS_LISTENER_RESOLVED = 'workflows.listener.resolved' as const;
export const WORKFLOWS_LISTENER_CANCELLED = 'workflows.listener.cancelled' as const;

export const workflowsWorkflowRunAttemptCreatedSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  attempt: z.number().int().positive(),
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  definitionId: nonEmptyStringSchema,
});
export type WorkflowsWorkflowRunAttemptCreatedEventDto = z.infer<
  typeof workflowsWorkflowRunAttemptCreatedSchema
>;

// Keep outbox terminal statuses narrower than the public status schemas, which
// also carry pending/running and job-only skipped.
export const workflowRunTerminalStatusSchema = z.enum(['succeeded', 'failed', 'cancelled']);
export const jobTerminalStatusSchema = z.enum(['succeeded', 'failed', 'cancelled', 'skipped']);
export const terminalStatusSchema = workflowRunTerminalStatusSchema;

export const workflowsWorkflowRunTerminatedSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  status: workflowRunTerminalStatusSchema,
});
export type WorkflowsWorkflowRunTerminatedEventDto = z.infer<
  typeof workflowsWorkflowRunTerminatedSchema
>;

export const workflowsWorkflowRunCancelledSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
});
export type WorkflowsWorkflowRunCancelledEventDto = z.infer<
  typeof workflowsWorkflowRunCancelledSchema
>;

export const workflowsJobExecutionTimedOutSchema = z.object({
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
});
export type WorkflowsJobExecutionTimedOutEventDto = z.infer<
  typeof workflowsJobExecutionTimedOutSchema
>;

export const workflowsJobTerminatedSchema = z.object({
  jobId: nonEmptyStringSchema,
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  status: jobTerminalStatusSchema,
  statusReason: jobStatusReasonSchema.nullable(),
});
export type WorkflowsJobTerminatedEventDto = z.infer<typeof workflowsJobTerminatedSchema>;

const settledStatusSchema = z.enum(['succeeded', 'failed']);

export const workflowsJobStepsSettledSchema = z.object({
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  status: settledStatusSchema,
});
export type WorkflowsJobStepsSettledEventDto = z.infer<typeof workflowsJobStepsSettledSchema>;

export const workflowsStepRestartEnqueuedSchema = z.object({
  jobId: nonEmptyStringSchema,
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  failedStepId: nonEmptyStringSchema,
  failedStepAttempt: z.number(),
  restartFromStepId: nonEmptyStringSchema,
  reason: z.string(),
});
export type WorkflowsStepRestartEnqueuedEventDto = z.infer<
  typeof workflowsStepRestartEnqueuedSchema
>;

export const workflowsStepAttemptTerminatedSchema = z.object({
  jobId: nonEmptyStringSchema,
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  stepId: nonEmptyStringSchema,
  attempt: z.number().int().positive(),
  logOutcome: logOutcomeSchema,
});
export type WorkflowsStepAttemptTerminatedEventDto = z.infer<
  typeof workflowsStepAttemptTerminatedSchema
>;

export const workflowsJobEventDeliveredSchema = z.object({
  jobId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  event: nonEmptyStringSchema,
  deliveryId: nonEmptyStringSchema,
});
export type WorkflowsJobEventDeliveredEventDto = z.infer<typeof workflowsJobEventDeliveredSchema>;

export const workflowsListenerStartedSchema = z.object({
  jobId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
});
export type WorkflowsListenerStartedEventDto = z.infer<typeof workflowsListenerStartedSchema>;

export const workflowsListenerResolvedSchema = z.object({
  jobId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  reason: z.enum(['until', 'timeout', 'max_executions', 'cancelled']),
});
export type WorkflowsListenerResolvedEventDto = z.infer<typeof workflowsListenerResolvedSchema>;

export const workflowsListenerCancelledSchema = z.object({
  jobId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
});
export type WorkflowsListenerCancelledEventDto = z.infer<typeof workflowsListenerCancelledSchema>;

export interface WorkflowsEventMapDto {
  [WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED]: WorkflowsWorkflowRunAttemptCreatedEventDto;
  [WORKFLOWS_WORKFLOW_RUN_TERMINATED]: WorkflowsWorkflowRunTerminatedEventDto;
  [WORKFLOWS_WORKFLOW_RUN_CANCELLED]: WorkflowsWorkflowRunCancelledEventDto;
  [WORKFLOWS_JOB_EXECUTION_TIMED_OUT]: WorkflowsJobExecutionTimedOutEventDto;
  [WORKFLOWS_JOB_TERMINATED]: WorkflowsJobTerminatedEventDto;
  [WORKFLOWS_JOB_STEPS_SETTLED]: WorkflowsJobStepsSettledEventDto;
  [WORKFLOWS_STEP_RESTART_ENQUEUED]: WorkflowsStepRestartEnqueuedEventDto;
  [WORKFLOWS_STEP_ATTEMPT_TERMINATED]: WorkflowsStepAttemptTerminatedEventDto;
  [WORKFLOWS_JOB_EVENT_DELIVERED]: WorkflowsJobEventDeliveredEventDto;
  [WORKFLOWS_LISTENER_STARTED]: WorkflowsListenerStartedEventDto;
  [WORKFLOWS_LISTENER_RESOLVED]: WorkflowsListenerResolvedEventDto;
  [WORKFLOWS_LISTENER_CANCELLED]: WorkflowsListenerCancelledEventDto;
}

export const workflowsEventSchemas = {
  [WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED]: workflowsWorkflowRunAttemptCreatedSchema,
  [WORKFLOWS_WORKFLOW_RUN_TERMINATED]: workflowsWorkflowRunTerminatedSchema,
  [WORKFLOWS_WORKFLOW_RUN_CANCELLED]: workflowsWorkflowRunCancelledSchema,
  [WORKFLOWS_JOB_EXECUTION_TIMED_OUT]: workflowsJobExecutionTimedOutSchema,
  [WORKFLOWS_JOB_TERMINATED]: workflowsJobTerminatedSchema,
  [WORKFLOWS_JOB_STEPS_SETTLED]: workflowsJobStepsSettledSchema,
  [WORKFLOWS_STEP_RESTART_ENQUEUED]: workflowsStepRestartEnqueuedSchema,
  [WORKFLOWS_STEP_ATTEMPT_TERMINATED]: workflowsStepAttemptTerminatedSchema,
  [WORKFLOWS_JOB_EVENT_DELIVERED]: workflowsJobEventDeliveredSchema,
  [WORKFLOWS_LISTENER_STARTED]: workflowsListenerStartedSchema,
  [WORKFLOWS_LISTENER_RESOLVED]: workflowsListenerResolvedSchema,
  [WORKFLOWS_LISTENER_CANCELLED]: workflowsListenerCancelledSchema,
} satisfies Record<keyof WorkflowsEventMapDto, z.ZodType>;
