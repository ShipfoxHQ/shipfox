import {z} from 'zod';

export const REGISTRATION_TOKEN_BATCH_HARD_MAX = 1000;
export const mintRegistrationTokensRunnerInstanceSchema = z.object({
  provider_runner_id: z.string().min(1).max(255),
});
export const mintRegistrationTokensBatchBodySchema = z
  .object({
    reservation_id: z.string().uuid(),
    runner_instances: z
      .array(mintRegistrationTokensRunnerInstanceSchema)
      .min(1)
      .max(REGISTRATION_TOKEN_BATCH_HARD_MAX),
  })
  .refine(
    (body) =>
      new Set(body.runner_instances.map((providerRunner) => providerRunner.provider_runner_id))
        .size === body.runner_instances.length,
    {message: 'provider_runner_id values must be unique', path: ['runner_instances']},
  );
export const mintedRegistrationTokenSchema = z.object({
  provider_runner_id: z.string(),
  registration_token: z.string(),
  expires_at: z.string().datetime(),
});
export const mintRegistrationTokensBatchResponseSchema = z.object({
  tokens: z.array(mintedRegistrationTokenSchema),
});
export type MintRegistrationTokensRunnerInstanceDto = z.infer<
  typeof mintRegistrationTokensRunnerInstanceSchema
>;
export type MintRegistrationTokensBatchBodyDto = z.infer<
  typeof mintRegistrationTokensBatchBodySchema
>;
export type MintedRegistrationTokenDto = z.infer<typeof mintedRegistrationTokenSchema>;
export type MintRegistrationTokensBatchResponseDto = z.infer<
  typeof mintRegistrationTokensBatchResponseSchema
>;
