import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const NOTION_PROVIDER = 'notion';
export type NotionProvider = typeof NOTION_PROVIDER;

export const notionWebhookEventNames = [
  'page.created',
  'page.content_updated',
  'page.properties_updated',
  'page.moved',
  'page.deleted',
  'page.undeleted',
  'page.locked',
  'page.unlocked',
  'data_source.created',
  'data_source.content_updated',
  'data_source.moved',
  'data_source.deleted',
  'data_source.undeleted',
  'data_source.schema_updated',
  'database.created',
  'database.moved',
  'database.deleted',
  'database.undeleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
] as const;
export const notionEventNames = notionWebhookEventNames;

export const notionWebhookEventNameSchema = z.enum(notionWebhookEventNames);
export const notionEventNameSchema = notionWebhookEventNameSchema;
export type NotionWebhookEventName = z.infer<typeof notionWebhookEventNameSchema>;
export type NotionEventName = NotionWebhookEventName;

const notionWebhookActorTypeSchema = z.enum(['person', 'bot', 'agent']);
const notionWebhookAccessibleByActorTypeSchema = z.enum(['person', 'bot']);
const notionWebhookEntityTypeSchema = z.enum(['page', 'data_source', 'database', 'comment']);

export const notionWebhookActorSchema = z
  .object({
    id: z.string().min(1),
    type: notionWebhookActorTypeSchema,
  })
  .passthrough();
export type NotionWebhookActorDto = z.infer<typeof notionWebhookActorSchema>;

const notionWebhookAccessibleByActorSchema = z
  .object({
    id: z.string().min(1),
    type: notionWebhookAccessibleByActorTypeSchema,
  })
  .passthrough();

export const notionWebhookEntitySchema = z
  .object({
    id: z.string().min(1),
    type: notionWebhookEntityTypeSchema,
  })
  .passthrough();
export type NotionWebhookEntityDto = z.infer<typeof notionWebhookEntitySchema>;

const notionWebhookEnvelopeFields = {
  id: z.string().min(1),
  timestamp: z.string().min(1),
  workspace_id: z.string().min(1),
  subscription_id: z.string().min(1),
  integration_id: z.string().min(1),
  authors: z.array(notionWebhookActorSchema).min(1),
  accessible_by: z.array(notionWebhookAccessibleByActorSchema).min(1).optional(),
  attempt_number: z.number().int().min(1).max(8),
  entity: notionWebhookEntitySchema,
  data: z.record(z.string(), z.unknown()),
};

export const notionWebhookBaseEnvelopeSchema = z
  .object({
    ...notionWebhookEnvelopeFields,
    type: z.string().min(1),
  })
  .passthrough();
export type NotionWebhookBaseEnvelopeDto = z.infer<typeof notionWebhookBaseEnvelopeSchema>;

export const notionWebhookEnvelopeSchema = z
  .object({
    ...notionWebhookEnvelopeFields,
    type: notionWebhookEventNameSchema,
  })
  .passthrough();
export type NotionWebhookEnvelopeDto = z.infer<typeof notionWebhookEnvelopeSchema>;
export const notionEventPayloadSchema = notionWebhookEnvelopeSchema;
export type NotionEventPayloadDto = NotionWebhookEnvelopeDto;

export const notionWebhookVerificationSchema = z.object({
  verification_token: z.string().min(1),
});
export type NotionWebhookVerificationDto = z.infer<typeof notionWebhookVerificationSchema>;
export const notionWebhookHandshakeSchema = notionWebhookVerificationSchema;
export type NotionWebhookHandshakeDto = NotionWebhookVerificationDto;

export const createNotionInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateNotionInstallBodyDto = z.infer<typeof createNotionInstallBodySchema>;

export const createNotionInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateNotionInstallResponseDto = z.infer<typeof createNotionInstallResponseSchema>;

export const notionCallbackQuerySchema = z.union([
  z.object({
    code: z.string().min(1),
    state: z.string().min(1),
  }),
  z.object({
    error: z.string().min(1),
    error_description: z.string().min(1).optional(),
    state: z.string().min(1),
  }),
]);
export type NotionCallbackQueryDto = z.infer<typeof notionCallbackQuerySchema>;

export const notionCallbackOutcomeSchema = z.enum([
  'connected',
  'reconnected',
  'access_denied',
  'already-linked',
  'state-invalid',
  'provider-unavailable',
]);
export type NotionCallbackOutcome = z.infer<typeof notionCallbackOutcomeSchema>;

const notionConnectedCallbackResponseSchema = z.object({
  outcome: z.literal('connected'),
  connection: integrationConnectionDtoSchema,
});
const notionReconnectedCallbackResponseSchema = z.object({
  outcome: z.literal('reconnected'),
  connection: integrationConnectionDtoSchema,
});
const notionAccessDeniedCallbackResponseSchema = z.object({
  outcome: z.literal('access_denied'),
});
const notionAlreadyLinkedCallbackResponseSchema = z.object({
  outcome: z.literal('already-linked'),
});
const notionStateInvalidCallbackResponseSchema = z.object({
  outcome: z.literal('state-invalid'),
});
const notionProviderUnavailableCallbackResponseSchema = z.object({
  outcome: z.literal('provider-unavailable'),
});

export const notionCallbackResponseSchema = z.discriminatedUnion('outcome', [
  notionConnectedCallbackResponseSchema,
  notionReconnectedCallbackResponseSchema,
  notionAccessDeniedCallbackResponseSchema,
  notionAlreadyLinkedCallbackResponseSchema,
  notionStateInvalidCallbackResponseSchema,
  notionProviderUnavailableCallbackResponseSchema,
]);
export type NotionCallbackResponseDto = z.infer<typeof notionCallbackResponseSchema>;

export const createE2eNotionConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  notion_workspace_id: z.string().min(1),
  workspace_name: z.string().min(1),
  bot_id: z.string().min(1),
  authorized_by_user_id: z.string().min(1),
  access_token: z.string().min(1),
  token_expires_at: z.string().optional(),
  display_name: z.string().min(1),
});
export type CreateE2eNotionConnectionBodyDto = z.infer<typeof createE2eNotionConnectionBodySchema>;

export const createE2eNotionConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eNotionConnectionResponseDto = z.infer<
  typeof createE2eNotionConnectionResponseSchema
>;
