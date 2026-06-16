import {z} from 'zod';
import {jobDtoSchema} from './job.js';
import {stepAttemptDtoSchema, stepDtoSchema} from './step.js';

export const runStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);

export type RunStatusDto = z.infer<typeof runStatusSchema>;

const isoDateTimeSchema = z.string().datetime();
const runListQueryBaseSchema = z.object({
  project_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  status: runStatusSchema.optional(),
  definition_id: z.string().uuid().optional(),
  trigger_source: z.string().optional(),
  created_from: isoDateTimeSchema.optional(),
  created_to: isoDateTimeSchema.optional(),
});

function validateDateWindow(
  value: {created_from?: string | undefined; created_to?: string | undefined},
  ctx: z.RefinementCtx,
) {
  if (!value.created_from || !value.created_to) return;
  const from = new Date(value.created_from);
  const to = new Date(value.created_to);
  if (from > to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'created_from must be before or equal to created_to',
      path: ['created_from'],
    });
    return;
  }

  const maxWindowMs = 365 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxWindowMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'created date window must be 365 days or less',
      path: ['created_to'],
    });
  }
}

export const runListQuerySchema = runListQueryBaseSchema.superRefine(validateDateWindow);

export type RunListQueryDto = z.infer<typeof runListQuerySchema>;

export const runAggregatesQuerySchema = runListQueryBaseSchema
  .omit({limit: true, cursor: true})
  .superRefine(validateDateWindow);

export type RunAggregatesQueryDto = z.infer<typeof runAggregatesQuerySchema>;

export const runDtoSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  name: z.string(),
  status: runStatusSchema,
  trigger_source: z.string(),
  trigger_event: z.string(),
  trigger_payload: z.record(z.string(), z.unknown()),
  inputs: z.record(z.string(), z.unknown()).nullable(),
  duration_ms: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type RunDto = z.infer<typeof runDtoSchema>;

export const runResponseSchema = runDtoSchema;

export type RunResponseDto = z.infer<typeof runResponseSchema>;

export const runDetailResponseSchema = runResponseSchema.extend({
  workflow_source_yaml: z.string().nullable(),
  workflow_document: z.unknown().nullable(),
  workflow_model: z.unknown().nullable(),
  jobs: z.array(
    jobDtoSchema.extend({
      steps: z.array(stepDtoSchema.extend({attempts: z.array(stepAttemptDtoSchema)})),
    }),
  ),
});

export type RunDetailResponseDto = z.infer<typeof runDetailResponseSchema>;

export const runListResponseSchema = z.object({
  runs: z.array(runResponseSchema),
  next_cursor: z.string().nullable(),
  filtered_total_count: z.number().int().nonnegative().nullable(),
});

export type RunListResponseDto = z.infer<typeof runListResponseSchema>;

const aggregateBucketSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});

export const runAggregatesResponseSchema = z.object({
  status: z.array(z.object({value: runStatusSchema, count: z.number().int().nonnegative()})),
  trigger_source: z.array(aggregateBucketSchema),
  workflow: z.array(aggregateBucketSchema),
});

export type RunAggregatesResponseDto = z.infer<typeof runAggregatesResponseSchema>;
