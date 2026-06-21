import {z} from 'zod';
import {jobDtoSchema} from './job.js';
import {runResponseSchema} from './run.js';
import {stepAttemptDtoSchema, stepDtoSchema} from './step.js';

// A step with its attempt history: one entry per dispatched attempt (a restarted
// step has more than one). `current_attempt` on the step points at the latest.
export const runStepDetailDtoSchema = stepDtoSchema.extend({
  attempts: z.array(stepAttemptDtoSchema),
});

export type RunStepDetailDto = z.infer<typeof runStepDetailDtoSchema>;

export const runJobDetailDtoSchema = jobDtoSchema.extend({
  steps: z.array(runStepDetailDtoSchema),
});

export type RunJobDetailDto = z.infer<typeof runJobDetailDtoSchema>;

// The run detail read model returned by `GET /workflows/runs/:id`: a run plus its
// jobs, each job's steps, and each step's attempt history.
export const runDetailResponseSchema = runResponseSchema.extend({
  jobs: z.array(runJobDetailDtoSchema),
});

export type RunDetailResponseDto = z.infer<typeof runDetailResponseSchema>;
