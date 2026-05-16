import {z} from 'zod';
import {integrationConnectionLifecycleStatusSchema} from './integrations.js';

export const e2eCreateIntegrationConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  provider: z.string().min(1),
  external_account_id: z.string().min(1),
  display_name: z.string().min(1).optional(),
  lifecycle_status: integrationConnectionLifecycleStatusSchema.optional(),
});

export type E2eCreateIntegrationConnectionBodyDto = z.infer<
  typeof e2eCreateIntegrationConnectionBodySchema
>;

export const e2eCreateIntegrationConnectionResponseSchema = z.object({
  connection: z.object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    provider: z.string(),
    external_account_id: z.string(),
    display_name: z.string(),
    lifecycle_status: integrationConnectionLifecycleStatusSchema,
  }),
});

export type E2eCreateIntegrationConnectionResponseDto = z.infer<
  typeof e2eCreateIntegrationConnectionResponseSchema
>;

export const e2eListIntegrationEventsQuerySchema = z.object({
  delivery_id: z.string().min(1).optional(),
  event_type: z.string().min(1).optional(),
});

export type E2eListIntegrationEventsQueryDto = z.infer<typeof e2eListIntegrationEventsQuerySchema>;

export const e2eIntegrationOutboxEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export type E2eIntegrationOutboxEventDto = z.infer<typeof e2eIntegrationOutboxEventSchema>;

export const e2eListIntegrationEventsResponseSchema = z.object({
  events: z.array(e2eIntegrationOutboxEventSchema),
});

export type E2eListIntegrationEventsResponseDto = z.infer<
  typeof e2eListIntegrationEventsResponseSchema
>;
