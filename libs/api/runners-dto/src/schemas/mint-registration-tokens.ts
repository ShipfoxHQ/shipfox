import {z} from 'zod';

export const REGISTRATION_TOKEN_BATCH_HARD_MAX = 1000;
export const mintRegistrationTokensProvisionedRunnerSchema = z.object({
  provisioned_runner_id: z.string().min(1).max(255),
});
export const mintRegistrationTokensBatchBodySchema = z
  .object({
    reservation_id: z.string().uuid(),
    provisioned_runners: z
      .array(mintRegistrationTokensProvisionedRunnerSchema)
      .min(1)
      .max(REGISTRATION_TOKEN_BATCH_HARD_MAX),
  })
  .refine(
    (body) =>
      new Set(
        body.provisioned_runners.map(
          (provisionedRunner) => provisionedRunner.provisioned_runner_id,
        ),
      ).size === body.provisioned_runners.length,
    {message: 'provisioned_runner_id values must be unique', path: ['provisioned_runners']},
  );
export const mintedRegistrationTokenSchema = z.object({
  provisioned_runner_id: z.string(),
  registration_token: z.string(),
  expires_at: z.string().datetime(),
});
export const mintRegistrationTokensBatchResponseSchema = z.object({
  tokens: z.array(mintedRegistrationTokenSchema),
});
export type MintRegistrationTokensProvisionedRunnerDto = z.infer<
  typeof mintRegistrationTokensProvisionedRunnerSchema
>;
export type MintRegistrationTokensBatchBodyDto = z.infer<
  typeof mintRegistrationTokensBatchBodySchema
>;
export type MintedRegistrationTokenDto = z.infer<typeof mintedRegistrationTokenSchema>;
export type MintRegistrationTokensBatchResponseDto = z.infer<
  typeof mintRegistrationTokensBatchResponseSchema
>;
