import {z} from 'zod';

export const MAX_MANUAL_REGISTRATION_TOKEN_TTL_SECONDS = 31_536_000;

export const createManualRegistrationTokenBodySchema = z.object({
  name: z.string().min(1).optional(),
  ttl_seconds: z
    .number()
    .int()
    .positive()
    .max(MAX_MANUAL_REGISTRATION_TOKEN_TTL_SECONDS)
    .optional(),
});

export type CreateManualRegistrationTokenBodyDto = z.infer<
  typeof createManualRegistrationTokenBodySchema
>;

export const createManualRegistrationTokenResponseSchema = z.object({
  id: z.string().uuid(),
  raw_token: z.string(),
  prefix: z.string(),
  name: z.string().nullable(),
  workspace_id: z.string().uuid(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});

export type CreateManualRegistrationTokenResponseDto = z.infer<
  typeof createManualRegistrationTokenResponseSchema
>;

export const manualRegistrationTokenDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  prefix: z.string(),
  name: z.string().nullable(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ManualRegistrationTokenDto = z.infer<typeof manualRegistrationTokenDtoSchema>;

export const listManualRegistrationTokensResponseSchema = z.object({
  manual_registration_tokens: z.array(manualRegistrationTokenDtoSchema),
});

export type ListManualRegistrationTokensResponseDto = z.infer<
  typeof listManualRegistrationTokensResponseSchema
>;

export const revokeManualRegistrationTokenResponseSchema = manualRegistrationTokenDtoSchema;

export type RevokeManualRegistrationTokenResponseDto = z.infer<
  typeof revokeManualRegistrationTokenResponseSchema
>;
