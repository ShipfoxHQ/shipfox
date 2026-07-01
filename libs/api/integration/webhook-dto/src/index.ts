import {connectionSlugSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const WEBHOOK_PROVIDER = 'webhook' as const;
export const WEBHOOK_RECEIVED_EVENT = 'received' as const;
export const WEBHOOK_RESERVED_SLUGS = ['github', 'gitea', 'sentry', 'manual', 'cron'] as const;

const webhookReservedSlugSet = new Set<string>(WEBHOOK_RESERVED_SLUGS);

export const webhookSlugSchema = z
  .string()
  .pipe(connectionSlugSchema)
  .refine((slug) => !webhookReservedSlugSet.has(slug), {
    message: 'Slug is reserved',
  });

export const createWebhookConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: webhookSlugSchema,
});
export type CreateWebhookConnectionBodyDto = z.infer<typeof createWebhookConnectionBodySchema>;

export const updateWebhookConnectionBodySchema = z.object({
  lifecycle_status: z.enum(['active', 'disabled']),
});
export type UpdateWebhookConnectionBodyDto = z.infer<typeof updateWebhookConnectionBodySchema>;

export const webhookConnectionDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string(),
  slug: connectionSlugSchema,
  lifecycle_status: z.enum(['active', 'disabled', 'error']),
  inbound_url: z.string().url(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type WebhookConnectionDto = z.infer<typeof webhookConnectionDtoSchema>;

export const listWebhookConnectionsQuerySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type ListWebhookConnectionsQueryDto = z.infer<typeof listWebhookConnectionsQuerySchema>;

export const listWebhookConnectionsResponseSchema = z.object({
  connections: z.array(webhookConnectionDtoSchema),
});
export type ListWebhookConnectionsResponseDto = z.infer<
  typeof listWebhookConnectionsResponseSchema
>;
