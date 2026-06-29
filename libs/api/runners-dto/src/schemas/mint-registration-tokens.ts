import {z} from 'zod';

export const REGISTRATION_TOKEN_BATCH_HARD_MAX = 1000;

export const mintRegistrationTokensResourceSchema = z.object({
  resource_id: z.string().min(1).max(200),
});

export const mintRegistrationTokensBatchBodySchema = z
  .object({
    reservation_id: z.string().uuid(),
    resources: z
      .array(mintRegistrationTokensResourceSchema)
      .min(1)
      .max(REGISTRATION_TOKEN_BATCH_HARD_MAX),
  })
  .refine(
    (body) =>
      new Set(body.resources.map((resource) => resource.resource_id)).size ===
      body.resources.length,
    {message: 'resource_id values must be unique', path: ['resources']},
  );

export const mintedRegistrationTokenSchema = z.object({
  resource_id: z.string(),
  registration_token: z.string(),
  expires_at: z.string().datetime(),
});

export const mintRegistrationTokensBatchResponseSchema = z.object({
  tokens: z.array(mintedRegistrationTokenSchema),
});

export type MintRegistrationTokensResourceDto = z.infer<
  typeof mintRegistrationTokensResourceSchema
>;
export type MintRegistrationTokensBatchBodyDto = z.infer<
  typeof mintRegistrationTokensBatchBodySchema
>;
export type MintedRegistrationTokenDto = z.infer<typeof mintedRegistrationTokenSchema>;
export type MintRegistrationTokensBatchResponseDto = z.infer<
  typeof mintRegistrationTokensBatchResponseSchema
>;
