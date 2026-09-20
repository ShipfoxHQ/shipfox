import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const POSTHOG_PROVIDER = 'posthog';
export type PosthogProvider = typeof POSTHOG_PROVIDER;

export const posthogRegionSchema = z.enum(['us', 'eu']);
export type PosthogRegion = z.infer<typeof posthogRegionSchema>;

export function posthogExternalAccountId(region: PosthogRegion, projectId: string): string {
  return `${region}:${projectId}`;
}

export const posthogProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type PosthogProjectDto = z.infer<typeof posthogProjectSchema>;

export const posthogConnectRequestSchema = z.object({
  region: posthogRegionSchema,
  api_key: z.string().min(1),
  project_id: z.string().min(1).optional(),
});
export type PosthogConnectRequestDto = z.infer<typeof posthogConnectRequestSchema>;
export const posthogConnectBodySchema = posthogConnectRequestSchema;
export type PosthogConnectBodyDto = PosthogConnectRequestDto;

export const posthogConnectedResponseSchema = z.object({
  status: z.literal('connected'),
  connection: integrationConnectionDtoSchema,
});

export const posthogSelectProjectResponseSchema = z.object({
  status: z.literal('select-project'),
  projects: z.array(posthogProjectSchema),
});

export const posthogConnectResponseSchema = z.discriminatedUnion('status', [
  posthogConnectedResponseSchema,
  posthogSelectProjectResponseSchema,
]);
export type PosthogConnectResponseDto = z.infer<typeof posthogConnectResponseSchema>;

export const posthogAlreadyConnectedResponseSchema = z.object({
  status: z.literal('already-connected'),
  connection_id: z.string().uuid(),
});
export type PosthogAlreadyConnectedResponseDto = z.infer<
  typeof posthogAlreadyConnectedResponseSchema
>;

export const posthogReplaceApiKeyRequestSchema = z.object({api_key: z.string().min(1)});
export type PosthogReplaceApiKeyRequestDto = z.infer<typeof posthogReplaceApiKeyRequestSchema>;
export const posthogReplaceApiKeyBodySchema = posthogReplaceApiKeyRequestSchema;
export type PosthogReplaceApiKeyBodyDto = PosthogReplaceApiKeyRequestDto;

export const createE2ePosthogConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  region: posthogRegionSchema,
  api_key: z.string().min(1),
  project_id: z.string().min(1),
  project_name: z.string().min(1),
  organization_id: z.string().min(1),
});
export type CreateE2ePosthogConnectionBodyDto = z.infer<
  typeof createE2ePosthogConnectionBodySchema
>;
export const createE2ePosthogConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2ePosthogConnectionResponseDto = z.infer<
  typeof createE2ePosthogConnectionResponseSchema
>;
