import {z} from 'zod';

export const jobPayloadStepSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  position: z.number(),
});

export type JobPayloadStepDto = z.infer<typeof jobPayloadStepSchema>;

export const jobPayloadSchema = z.object({
  job_id: z.string().uuid(),
  run_id: z.string().uuid(),
  job_name: z.string(),
  steps: z.array(jobPayloadStepSchema).min(1),
});

export type JobPayloadDto = z.infer<typeof jobPayloadSchema>;

// The claim response adds a short-lived, job-scoped lease token. The runner
// authenticates the per-step pull/report calls with it (the job is named by the
// token's claims), while the long-lived runner token stays for claim/heartbeat.
export const jobPayloadResponseSchema = jobPayloadSchema.extend({
  lease_token: z.string(),
});
export type JobPayloadResponseDto = z.infer<typeof jobPayloadResponseSchema>;
