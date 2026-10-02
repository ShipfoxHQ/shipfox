import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const createSentryInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateSentryInstallBodyDto = z.infer<typeof createSentryInstallBodySchema>;

export const createSentryInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateSentryInstallResponseDto = z.infer<typeof createSentryInstallResponseSchema>;

// org_slug is deliberately absent: it is derived from Sentry after the exchange,
// so a forged slug in the body cannot influence the stored connection.
export const sentryConnectBodySchema = z.object({
  workspace_id: z.string().uuid(),
  code: z.string().min(1),
  installation_id: z.string().min(1),
});
export type SentryConnectBodyDto = z.infer<typeof sentryConnectBodySchema>;

export const sentryConnectResponseSchema = integrationConnectionDtoSchema;
export type SentryConnectResponseDto = z.infer<typeof sentryConnectResponseSchema>;

export const createE2eSentryConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  installation_uuid: z.string().min(1),
  org_slug: z.string().min(1),
  display_name: z.string().min(1),
  access_token: z.string().min(1),
});
export type CreateE2eSentryConnectionBodyDto = z.infer<typeof createE2eSentryConnectionBodySchema>;

export const createE2eSentryConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eSentryConnectionResponseDto = z.infer<
  typeof createE2eSentryConnectionResponseSchema
>;
