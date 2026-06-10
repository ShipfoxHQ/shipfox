import {z} from 'zod';

export const jobPayloadStepSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  position: z.number(),
});

export type JobPayloadStepDto = z.infer<typeof jobPayloadStepSchema>;

export const checkoutIntentSchema = z.object({
  repository_url: z.string(),
  ref: z.string(),
  provider: z.string(),
  source_connection_id: z.string().uuid(),
  external_repository_id: z.string(),
});

export type CheckoutIntentDto = z.infer<typeof checkoutIntentSchema>;

export const jobPayloadSchema = z.object({
  job_id: z.string().uuid(),
  run_id: z.string().uuid(),
  job_name: z.string(),
  steps: z.array(jobPayloadStepSchema).min(1),
  checkout: checkoutIntentSchema.nullish(),
});

export type JobPayloadDto = z.infer<typeof jobPayloadSchema>;

export const jobPayloadResponseSchema = jobPayloadSchema;
export type JobPayloadResponseDto = z.infer<typeof jobPayloadResponseSchema>;
