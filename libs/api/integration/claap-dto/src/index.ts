import {
  integrationConnectionDtoSchema,
  integrationConnectionLifecycleStatusSchema,
} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const CLAAP_PROVIDER = 'claap';
export type ClaapProvider = typeof CLAAP_PROVIDER;

export const claapConnectBodySchema = z.object({
  workspace_id: z.string().uuid(),
  api_key: z.string().min(1),
});
export type ClaapConnectBodyDto = z.infer<typeof claapConnectBodySchema>;

export const claapConnectionResponseSchema = integrationConnectionDtoSchema;

export const claapConnectResponseSchema = z.object({
  connection: claapConnectionResponseSchema,
});
export type ClaapConnectResponseDto = z.infer<typeof claapConnectResponseSchema>;

export const claapReplaceApiKeyBodySchema = z.object({api_key: z.string().min(1)});
export type ClaapReplaceApiKeyBodyDto = z.infer<typeof claapReplaceApiKeyBodySchema>;

export const createE2eClaapConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  api_key: z.string().min(1),
  claap_workspace_id: z.string().min(1),
  claap_workspace_name: z.string().min(1),
  lifecycle_status: integrationConnectionLifecycleStatusSchema.optional(),
});
export type CreateE2eClaapConnectionBodyDto = z.infer<typeof createE2eClaapConnectionBodySchema>;
export const createE2eClaapConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eClaapConnectionResponseDto = z.infer<
  typeof createE2eClaapConnectionResponseSchema
>;
