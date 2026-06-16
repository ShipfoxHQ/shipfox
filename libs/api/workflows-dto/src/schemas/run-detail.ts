import {z} from 'zod';
import {jobDtoSchema} from './job.js';
import {runResponseSchema} from './run.js';
import {stepAttemptDtoSchema, stepDtoSchema} from './step.js';

export const runDetailStepDtoSchema = stepDtoSchema.extend({
  attempts: z.array(stepAttemptDtoSchema),
});

export type RunDetailStepDto = z.infer<typeof runDetailStepDtoSchema>;

export const runDetailJobDtoSchema = jobDtoSchema.extend({
  steps: z.array(runDetailStepDtoSchema),
});

export type RunDetailJobDto = z.infer<typeof runDetailJobDtoSchema>;

export const runDetailResponseSchema = runResponseSchema.extend({
  jobs: z.array(runDetailJobDtoSchema),
});

export type RunDetailResponseDto = z.infer<typeof runDetailResponseSchema>;
