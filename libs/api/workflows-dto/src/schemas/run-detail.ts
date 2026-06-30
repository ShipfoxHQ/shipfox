import {z} from 'zod';
import {jobDtoSchema} from './job.js';
import {runResponseSchema} from './run.js';
import {stepAttemptDtoSchema, stepDtoSchema} from './step.js';

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
  run_id: z.string().uuid(),
  sequence: z.number().int().positive(),
  name: z.string(),
  status: jobExecutionStatusSchema,
  status_reason: z.string().nullable(),
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
export const runStepDetailDtoSchema = stepDtoSchema.extend({
  attempts: z.array(stepAttemptDtoSchema),
});

export type RunStepDetailDto = z.infer<typeof runStepDetailDtoSchema>;

export const runExecutionDetailDtoSchema = jobExecutionDtoSchema.extend({
  steps: z.array(runStepDetailDtoSchema),
});

export type RunExecutionDetailDto = z.infer<typeof runExecutionDetailDtoSchema>;

export const runJobDetailDtoSchema = jobDtoSchema.extend({
  executions: z.array(runExecutionDetailDtoSchema),
});

export type RunJobDetailDto = z.infer<typeof runJobDetailDtoSchema>;

// The run detail read model returned by `GET /workflows/runs/:id`: a run plus its
// jobs, each job's steps, and each step's attempt history.
export const runDetailResponseSchema = runResponseSchema.extend({
  latest_attempt: z.number().int().positive(),
  jobs: z.array(runJobDetailDtoSchema),
});

export type RunDetailResponseDto = z.infer<typeof runDetailResponseSchema>;
