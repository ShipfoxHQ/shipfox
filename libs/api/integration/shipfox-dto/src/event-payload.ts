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

const projectSchema = z
  .object({
    id: idSchema.describe('Project ID.'),
    name: nonEmptyStringSchema.describe('Project name when Shipfox delivers the event.'),
  })
  .describe('Project that owns the run.');

const workflowSchema = z
  .object({
    id: idSchema.describe('Workflow definition ID.'),
    name: nonEmptyStringSchema.describe('Workflow `name`.'),
    path: nonEmptyStringSchema
      .nullable()
      .describe(
        'Workflow file path in the repository, for example `.shipfox/workflows/build.yml`.',
      ),
  })
  .describe('Workflow that the run executes.');

const runIdentitySchema = z.object({
  id: idSchema.describe('Run ID.'),
  number: z.number().int().positive().describe('Run number within the workflow.'),
  attempt: z.number().int().positive().describe('Run attempt. A rerun increments it.'),
  name: nonEmptyStringSchema.describe('Run name.'),
  origin: z
    .enum(['synced', 'dev'])
    .describe('`synced` for a run of a synced workflow definition, `dev` for a dev run.'),
  trigger: z
    .object({
      source: nonEmptyStringSchema.describe('Trigger `source` that started the run.'),
      event: nonEmptyStringSchema.describe('Event name that started the run.'),
    })
    .describe('Trigger that started the run.'),
  ref: z.string().nullable().describe('Git ref of the run, when known.'),
  commit: z.string().nullable().describe('Git commit SHA of the run, when known.'),
  parent_run_id: idSchema
    .nullable()
    .describe('ID of the run that started this run with `start_workflow_run`.'),
  root_run_id: idSchema
    .nullable()
    .describe('ID of the first run in a chain of runs started with `start_workflow_run`.'),
  created_at: timestampSchema.describe('Time the run was created.'),
});

const runEventPayloadBaseSchema = z.object({
  project: projectSchema,
  workflow: workflowSchema,
  run: runIdentitySchema.describe('Run that the event is about.'),
});

const jobIdentitySchema = z.object({
  id: idSchema.describe('Job ID.'),
  key: nonEmptyStringSchema.describe('Job key in the workflow `jobs` map.'),
  mode: z
    .enum(['one_shot', 'listening'])
    .describe('`listening` for a listening job, otherwise `one_shot`.'),
  execution: z
    .object({
      id: idSchema.describe('Job execution ID.'),
      sequence: z
        .number()
        .int()
        .positive()
        .describe('Execution number within the job. A listening job has one per event batch.'),
    })
    .describe('Job execution the event is about.'),
});

const jobEventPayloadBaseSchema = runEventPayloadBaseSchema.extend({
  job: jobIdentitySchema,
});

export const shipfoxRunRequestedEventPayloadSchema = runEventPayloadBaseSchema.extend({
  run: runIdentitySchema
    .extend({
      status: z
        .enum(['pending', 'waiting'])
        .describe('`waiting` when the run waits for its concurrency group, otherwise `pending`.'),
    })
    .describe('Run that the event is about.'),
});
export type ShipfoxRunRequestedEventPayloadDto = z.infer<
  typeof shipfoxRunRequestedEventPayloadSchema
>;

export const shipfoxRunStartedEventPayloadSchema = runEventPayloadBaseSchema.extend({
  run: runIdentitySchema
    .extend({
      status: z.literal('running').describe('Run status.'),
      started_at: timestampSchema.describe('Time the run attempt started running.'),
    })
    .describe('Run that the event is about.'),
});
export type ShipfoxRunStartedEventPayloadDto = z.infer<typeof shipfoxRunStartedEventPayloadSchema>;

export const shipfoxRunCompletedEventPayloadSchema = runEventPayloadBaseSchema.extend({
  run: runIdentitySchema
    .extend({
      status: z
        .enum(['succeeded', 'failed', 'cancelled'])
        .describe('Final status of the run attempt.'),
      status_reason: z
        .enum([
          'job_failed',
          'timed_out',
          'user_cancelled',
          'concurrency_superseded',
          'output_invalid',
          'output_too_large',
        ])
        .nullable()
        .describe('Why the run attempt failed or was cancelled, when known.'),
      started_at: timestampSchema
        .nullable()
        .describe('Time the run attempt started running. `null` when it never started.'),
      finished_at: timestampSchema.describe('Time the run attempt finished.'),
      outputs: outputsSchema.describe(
        'Workflow `outputs` of a succeeded run. `null` for other statuses.',
      ),
    })
    .describe('Run that the event is about.'),
});
export type ShipfoxRunCompletedEventPayloadDto = z.infer<
  typeof shipfoxRunCompletedEventPayloadSchema
>;

const jobQueuedSchema = jobIdentitySchema
  .extend({
    status: z.literal('pending').describe('Job status.'),
    queued_at: timestampSchema.describe('Time the execution was queued.'),
  })
  .describe('Job that the event is about.');

export const shipfoxJobQueuedEventPayloadSchema = jobEventPayloadBaseSchema.extend({
  job: jobQueuedSchema,
});
export type ShipfoxJobQueuedEventPayloadDto = z.infer<typeof shipfoxJobQueuedEventPayloadSchema>;

const jobStartedSchema = jobIdentitySchema
  .extend({
    status: z.literal('running').describe('Job status.'),
    runner_labels: z
      .array(nonEmptyStringSchema)
      .min(1)
      .nullable()
      .describe('Labels of the runner that claimed the execution, when known.'),
    started_at: timestampSchema.describe('Time a runner claimed the execution.'),
  })
  .describe('Job that the event is about.');

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
const jobCompletedSchema = jobIdentitySchema
  .omit({execution: true})
  .extend({
    status: z
      .enum(['succeeded', 'failed', 'cancelled', 'skipped'])
      .describe('Final status of the job.'),
    status_reason: jobStatusReasonSchema
      .nullable()
      .describe('Why the job failed, was cancelled, or was skipped, when known.'),
    finished_at: timestampSchema.describe('Time the job finished.'),
    outputs: outputsSchema.describe('Job `outputs` of a succeeded job. `null` for other statuses.'),
  })
  .describe('Job that the event is about.');

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
