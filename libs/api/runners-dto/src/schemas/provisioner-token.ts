import {z} from 'zod';

export const MAX_PROVISIONER_TOKEN_TTL_SECONDS = 31_536_000;

export const createProvisionerTokenBodySchema = z.object({
  name: z.string().min(1).optional(),
  ttl_seconds: z.number().int().positive().max(MAX_PROVISIONER_TOKEN_TTL_SECONDS).optional(),
});

export type CreateProvisionerTokenBodyDto = z.infer<typeof createProvisionerTokenBodySchema>;

export const createProvisionerTokenResponseSchema = z.object({
  id: z.string().uuid(),
  raw_token: z.string(),
  prefix: z.string(),
  name: z.string().nullable(),
  workspace_id: z.string().uuid(),
  created_by_user_id: z.string().uuid(),
  revoked_by_user_id: z.string().uuid().nullable(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CreateProvisionerTokenResponseDto = z.infer<
  typeof createProvisionerTokenResponseSchema
>;

export const provisionerTokenDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  prefix: z.string(),
  name: z.string().nullable(),
  created_by_user_id: z.string().uuid(),
  revoked_by_user_id: z.string().uuid().nullable(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ProvisionerTokenDto = z.infer<typeof provisionerTokenDtoSchema>;

export const listProvisionerTokensResponseSchema = z.object({
  tokens: z.array(provisionerTokenDtoSchema),
});

export type ListProvisionerTokensResponseDto = z.infer<typeof listProvisionerTokensResponseSchema>;

export const revokeProvisionerTokenResponseSchema = provisionerTokenDtoSchema;

export type RevokeProvisionerTokenResponseDto = z.infer<
  typeof revokeProvisionerTokenResponseSchema
>;

export const provisionerIdentityResponseSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
});

export type ProvisionerIdentityResponseDto = z.infer<typeof provisionerIdentityResponseSchema>;
