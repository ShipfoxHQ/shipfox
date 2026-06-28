import {z} from 'zod';

export const runnerLabelSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i);

export const registerRunnerBodySchema = z.object({
  labels: z.array(runnerLabelSchema).min(1).max(50),
});

export const registerRunnerResponseSchema = z.object({
  session_token: z.string().min(1),
  session_id: z.string().uuid(),
  mode: z.enum(['manual', 'ephemeral']),
  max_claims: z.number().int().positive().nullable(),
});

export type RegisterRunnerBodyDto = z.infer<typeof registerRunnerBodySchema>;
export type RegisterRunnerResponseDto = z.infer<typeof registerRunnerResponseSchema>;
