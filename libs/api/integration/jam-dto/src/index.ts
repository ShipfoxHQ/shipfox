import {
  integrationConnectionDtoSchema,
  integrationConnectionLifecycleStatusSchema,
} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const JAM_PROVIDER = 'jam';
export type JamProvider = typeof JAM_PROVIDER;

export const JAM_TOKEN_PREFIX = 'jam_pat_';

export const jamConnectBodySchema = z.object({
  workspace_id: z.string().uuid(),
  token: z.string().min(1),
});
export type JamConnectBodyDto = z.infer<typeof jamConnectBodySchema>;

export const jamConnectionResponseSchema = integrationConnectionDtoSchema;

export const jamConnectResponseSchema = z.object({connection: jamConnectionResponseSchema});
export type JamConnectResponseDto = z.infer<typeof jamConnectResponseSchema>;

export const jamReplaceTokenBodySchema = z.object({token: z.string().min(1)});
export type JamReplaceTokenBodyDto = z.infer<typeof jamReplaceTokenBodySchema>;

export const createE2eJamConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  token: z.string().min(1),
  team_id: z.string().min(1),
  user_id: z.string().min(1),
  user_name: z.string().min(1),
  user_email: z.string().min(1).optional(),
  lifecycle_status: integrationConnectionLifecycleStatusSchema.optional(),
});
export type CreateE2eJamConnectionBodyDto = z.infer<typeof createE2eJamConnectionBodySchema>;
export const createE2eJamConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eJamConnectionResponseDto = z.infer<
  typeof createE2eJamConnectionResponseSchema
>;
