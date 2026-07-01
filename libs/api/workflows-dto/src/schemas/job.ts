import {z} from 'zod';
import {
  jobListeningSchema,
  jobModeSchema,
  listenerStatusSchema,
  resolutionReasonSchema,
} from './job-listening.js';

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

export const jobDurationDtoSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('none')}),
  z.object({kind: z.literal('queued'), from_iso: z.string()}),
  z.object({kind: z.literal('running'), from_iso: z.string()}),
  z.object({kind: z.literal('finished'), from_iso: z.string(), to_iso: z.string()}),
]);

export const jobDtoSchema = z.object({
  id: z.string().uuid(),
  run_attempt_id: z.string().uuid(),
  name: z.string(),
  mode: jobModeSchema,
  name_template: z.string().nullable(),
  status: jobStatusSchema,
  status_reason: jobStatusReasonSchema.nullable(),
  carried_over: z.boolean(),
  listening: jobListeningSchema.nullable(),
  listener_status: listenerStatusSchema,
  resolution_reason: resolutionReasonSchema.nullable(),
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
  duration: jobDurationDtoSchema,
});

export type JobDto = z.infer<typeof jobDtoSchema>;
export type JobDurationDto = z.infer<typeof jobDurationDtoSchema>;
export type JobStatusDto = z.infer<typeof jobStatusSchema>;
export type JobStatusReasonDto = z.infer<typeof jobStatusReasonSchema>;
