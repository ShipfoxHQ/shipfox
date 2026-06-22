import {z} from 'zod';

export const triggerEventOriginSchema = z.enum(['integration', 'manual']);
export type TriggerEventOriginDto = z.infer<typeof triggerEventOriginSchema>;

export const triggerEventOutcomeSchema = z.enum(['received', 'routed', 'discarded', 'failed']);
export type TriggerEventOutcomeDto = z.infer<typeof triggerEventOutcomeSchema>;

export const triggerDecisionOutcomeSchema = z.enum(['triggered', 'errored']);
export type TriggerDecisionOutcomeDto = z.infer<typeof triggerDecisionOutcomeSchema>;

/**
 * List rows omit payload because webhook bodies can be large/untrusted.
 * The full payload lives only on the detail response.
 */
export const triggerEventListItemDtoSchema = z.object({
  id: z.string().uuid(),
  event_ref: z.string(),
  origin: triggerEventOriginSchema,
  workspace_id: z.string().uuid(),
  source: z.string(),
  event: z.string(),
  delivery_id: z.string().nullable(),
  connection_id: z.string().uuid().nullable(),
  outcome: triggerEventOutcomeSchema,
  matched_count: z.number().int().nonnegative(),
  received_at: z.string(),
  processed_at: z.string().nullable(),
  created_at: z.string(),
});
export type TriggerEventListItemDto = z.infer<typeof triggerEventListItemDtoSchema>;

export const triggerEventDtoSchema = triggerEventListItemDtoSchema.extend({
  payload: z.record(z.string(), z.unknown()).nullable(),
});
export type TriggerEventDto = z.infer<typeof triggerEventDtoSchema>;

export const triggerDecisionDtoSchema = z.object({
  id: z.string().uuid(),
  received_event_id: z.string().uuid(),
  subscription_id: z.string().uuid(),
  workflow_definition_id: z.string().uuid(),
  project_id: z.string().uuid(),
  decision: triggerDecisionOutcomeSchema,
  run_id: z.string().uuid().nullable(),
  run_name: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
});
export type TriggerDecisionDto = z.infer<typeof triggerDecisionDtoSchema>;

const isoDateTimeSchema = z.string().datetime();

// `outcome` is the only multi-select filter. Accept a single value (`?outcome=routed`),
// a comma-separated list (`?outcome=routed,failed`), or repeated keys
// (`?outcome=routed&outcome=failed`). Blank entries are dropped so `?outcome=` and a
// trailing comma mean "no outcome filter" rather than an invalid empty value.
const outcomeFilterSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  const entries = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}, z.array(triggerEventOutcomeSchema).optional());

const triggerEventListQueryBaseSchema = z.object({
  workspace_id: z.string().uuid(),
  source: z.string().optional(),
  event: z.string().optional(),
  outcome: outcomeFilterSchema,
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

function validateDateWindow(
  value: {from?: string | undefined; to?: string | undefined},
  ctx: z.RefinementCtx,
) {
  if (!value.from || !value.to) return;
  if (new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'from must be before or equal to to',
      path: ['from'],
    });
  }
}

export const triggerEventListQuerySchema =
  triggerEventListQueryBaseSchema.superRefine(validateDateWindow);
export type TriggerEventListQueryDto = z.infer<typeof triggerEventListQuerySchema>;

export const triggerEventListResponseSchema = z.object({
  trigger_events: z.array(triggerEventListItemDtoSchema),
  next_cursor: z.string().nullable(),
});
export type TriggerEventListResponseDto = z.infer<typeof triggerEventListResponseSchema>;

export const triggerEventDetailResponseSchema = triggerEventDtoSchema.extend({
  decisions: z.array(triggerDecisionDtoSchema),
});
export type TriggerEventDetailResponseDto = z.infer<typeof triggerEventDetailResponseSchema>;
