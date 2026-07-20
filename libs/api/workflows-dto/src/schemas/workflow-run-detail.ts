import {z} from 'zod';
import {jobDtoSchema} from './job.js';
import {workflowExecutionEventSchema} from './job-listening.js';
import {stepAttemptDtoSchema, stepDtoObjectSchema, stepStatusReasonRefinement} from './step.js';
import {workflowRunAttemptDtoSchema, workflowRunResponseSchema} from './workflow-run.js';

export const jobExecutionStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const jobExecutionDtoSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  sequence: z.number().int().positive(),
  name: z.string(),
  status: jobExecutionStatusSchema,
  status_reason: z.string().nullable(),
  trigger_events: z.array(workflowExecutionEventSchema).default([]),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  queued_at: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  timed_out_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type JobExecutionDto = z.infer<typeof jobExecutionDtoSchema>;

// A step with its attempt history: one entry per dispatched attempt (a restarted
// step has more than one). `current_attempt` on the step points at the latest.
export const workflowRunStepDetailDtoSchema = stepDtoObjectSchema
  .extend({
    exit_code: z.number().int().nullable(),
    outputs: z.record(z.string(), z.unknown()).nullable(),
    response: z.string().nullable(),
    gate_result: stepAttemptDtoSchema.shape.gate_result,
    attempts: z.array(stepAttemptDtoSchema),
  })
  .refine(...stepStatusReasonRefinement);

export type WorkflowRunStepDetailDto = z.infer<typeof workflowRunStepDetailDtoSchema>;

export const workflowRunJobExecutionDetailDtoSchema = jobExecutionDtoSchema.extend({
  steps: z.array(workflowRunStepDetailDtoSchema),
});

export type WorkflowRunJobExecutionDetailDto = z.infer<
  typeof workflowRunJobExecutionDetailDtoSchema
>;

export const workflowRunJobDetailDtoSchema = jobDtoSchema.extend({
  job_executions: z.array(workflowRunJobExecutionDetailDtoSchema),
});

export type WorkflowRunJobDetailDto = z.infer<typeof workflowRunJobDetailDtoSchema>;

// The run detail read model returned by `GET /workflows/runs/:id`: a run plus its
// jobs, each job's steps, and each step's attempt history.
export const workflowRunDetailResponseSchema = workflowRunResponseSchema.extend({
  run_attempt: workflowRunAttemptDtoSchema,
  jobs: z.array(workflowRunJobDetailDtoSchema),
});

export type WorkflowRunDetailResponseDto = z.infer<typeof workflowRunDetailResponseSchema>;
