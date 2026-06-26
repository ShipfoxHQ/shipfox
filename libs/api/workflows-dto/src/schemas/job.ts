import {z} from 'zod';

export const jobStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

export const jobStatusReasonSchema = z.enum([
  'dependency_not_completed',
  'condition_false',
  'user_cancelled',
  'run_cancelled',
  'timed_out',
  'runner_lost',
  'step_failed',
  'unknown',
]);

export const jobDtoSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  name: z.string(),
  status: jobStatusSchema,
  status_reason: jobStatusReasonSchema.nullable(),
  dependencies: z.array(z.string()),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  // queued_at/started_at are eventually consistent: null until the runner queue/claim
  // events project onto the job row. queue time = started_at - queued_at, run time =
  // finished_at - started_at.
  queued_at: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});

export type JobDto = z.infer<typeof jobDtoSchema>;
export type JobStatusDto = z.infer<typeof jobStatusSchema>;
export type JobStatusReasonDto = z.infer<typeof jobStatusReasonSchema>;
