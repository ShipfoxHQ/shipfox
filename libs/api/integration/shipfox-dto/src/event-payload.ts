import {z} from 'zod';
import {
  SHIPFOX_JOB_COMPLETED_EVENT,
  SHIPFOX_JOB_QUEUED_EVENT,
  SHIPFOX_JOB_STARTED_EVENT,
  SHIPFOX_RUN_COMPLETED_EVENT,
  SHIPFOX_RUN_REQUESTED_EVENT,
  SHIPFOX_RUN_STARTED_EVENT,
} from './constants.js';

const nonEmptyStringSchema = z.string().min(1);
const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime();
const outputsSchema = z.record(z.string(), z.unknown()).nullable();

const projectSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema,
});

const workflowSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema,
  path: nonEmptyStringSchema.nullable(),
});

const runIdentitySchema = z.object({
  id: idSchema,
  number: z.number().int().positive(),
  attempt: z.number().int().positive(),
  name: nonEmptyStringSchema,
  origin: z.enum(['synced', 'dev']),
  trigger: z.object({
    source: nonEmptyStringSchema,
    event: nonEmptyStringSchema,
  }),
  ref: z.string().nullable(),
  commit: z.string().nullable(),
  parent_run_id: idSchema.nullable(),
  root_run_id: idSchema.nullable(),
  created_at: timestampSchema,
});

const runEventPayloadBaseSchema = z.object({
  project: projectSchema,
  workflow: workflowSchema,
  run: runIdentitySchema,
});

const jobIdentitySchema = z.object({
  id: idSchema,
  key: nonEmptyStringSchema,
  mode: z.enum(['one_shot', 'listening']),
  execution: z.object({
    id: idSchema,
    sequence: z.number().int().positive(),
  }),
});

const jobEventPayloadBaseSchema = runEventPayloadBaseSchema.extend({
  job: jobIdentitySchema,
});

export const shipfoxRunRequestedEventPayloadSchema = runEventPayloadBaseSchema.extend({
  run: runIdentitySchema.extend({
    status: z.enum(['pending', 'waiting']),
  }),
});
export type ShipfoxRunRequestedEventPayloadDto = z.infer<
  typeof shipfoxRunRequestedEventPayloadSchema
>;

export const shipfoxRunStartedEventPayloadSchema = runEventPayloadBaseSchema.extend({
  run: runIdentitySchema.extend({
    status: z.literal('running'),
    started_at: timestampSchema,
  }),
});
export type ShipfoxRunStartedEventPayloadDto = z.infer<typeof shipfoxRunStartedEventPayloadSchema>;

export const shipfoxRunCompletedEventPayloadSchema = runEventPayloadBaseSchema.extend({
  run: runIdentitySchema.extend({
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    status_reason: z
      .enum([
        'job_failed',
        'timed_out',
        'user_cancelled',
        'concurrency_superseded',
        'output_invalid',
        'output_too_large',
      ])
      .nullable(),
    started_at: timestampSchema.nullable(),
    finished_at: timestampSchema,
    outputs: outputsSchema,
  }),
});
export type ShipfoxRunCompletedEventPayloadDto = z.infer<
  typeof shipfoxRunCompletedEventPayloadSchema
>;

const jobQueuedSchema = jobIdentitySchema.extend({
  status: z.literal('pending'),
  queued_at: timestampSchema,
});

export const shipfoxJobQueuedEventPayloadSchema = jobEventPayloadBaseSchema.extend({
  job: jobQueuedSchema,
});
export type ShipfoxJobQueuedEventPayloadDto = z.infer<typeof shipfoxJobQueuedEventPayloadSchema>;

const jobStartedSchema = jobIdentitySchema.extend({
  status: z.literal('running'),
  runner_labels: z.array(nonEmptyStringSchema).min(1).nullable(),
  started_at: timestampSchema,
});

export const shipfoxJobStartedEventPayloadSchema = jobEventPayloadBaseSchema.extend({
  job: jobStartedSchema,
});
export type ShipfoxJobStartedEventPayloadDto = z.infer<typeof shipfoxJobStartedEventPayloadSchema>;

const jobStatusReasonSchema = z.enum([
  'dependency_not_completed',
  'condition_false',
  'default_gate_rejected',
  'condition_rejected',
  'condition_errored',
  'user_cancelled',
  'run_cancelled',
  'concurrency_superseded',
  'timed_out',
  'lease_expired',
  'provider_lost',
  'lifecycle_violation',
  'runner_lost',
  'output_too_large',
  'step_failed',
  'unknown',
  'output_invalid',
]);

// A skipped job never had an execution, so completion carries none.
const jobCompletedSchema = jobIdentitySchema.omit({execution: true}).extend({
  status: z.enum(['succeeded', 'failed', 'cancelled', 'skipped']),
  status_reason: jobStatusReasonSchema.nullable(),
  finished_at: timestampSchema,
  outputs: outputsSchema,
});

export const shipfoxJobCompletedEventPayloadSchema = jobEventPayloadBaseSchema.extend({
  job: jobCompletedSchema,
});
export type ShipfoxJobCompletedEventPayloadDto = z.infer<
  typeof shipfoxJobCompletedEventPayloadSchema
>;

export const shipfoxEventPayloadSchemas = {
  [SHIPFOX_RUN_REQUESTED_EVENT]: shipfoxRunRequestedEventPayloadSchema,
  [SHIPFOX_RUN_STARTED_EVENT]: shipfoxRunStartedEventPayloadSchema,
  [SHIPFOX_RUN_COMPLETED_EVENT]: shipfoxRunCompletedEventPayloadSchema,
  [SHIPFOX_JOB_QUEUED_EVENT]: shipfoxJobQueuedEventPayloadSchema,
  [SHIPFOX_JOB_STARTED_EVENT]: shipfoxJobStartedEventPayloadSchema,
  [SHIPFOX_JOB_COMPLETED_EVENT]: shipfoxJobCompletedEventPayloadSchema,
} as const;
