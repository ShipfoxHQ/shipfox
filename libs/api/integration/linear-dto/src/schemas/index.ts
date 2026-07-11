import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const LINEAR_PROVIDER = 'linear';

export type LinearProvider = typeof LINEAR_PROVIDER;

export const linearWebhookResourceTypes = [
  'Issue',
  'Comment',
  'IssueLabel',
  'Project',
  'Cycle',
] as const;
export const linearWebhookActions = ['create', 'update', 'remove'] as const;
export const linearAgentSessionWebhookActions = ['created', 'prompted'] as const;

const linearDataWebhookEventNames = linearWebhookResourceTypes.flatMap((type) =>
  linearWebhookActions.map((action) => `${type}.${action}` as const),
);
export const linearAgentSessionWebhookEventNames = linearAgentSessionWebhookActions.map(
  (action) => `agentSession.${action}` as const,
);
export const linearWebhookEventNames = [
  ...linearDataWebhookEventNames,
  ...linearAgentSessionWebhookEventNames,
] as const;

export type LinearWebhookResourceType = (typeof linearWebhookResourceTypes)[number];
export type LinearWebhookAction = (typeof linearWebhookActions)[number];
export type LinearAgentSessionWebhookAction = (typeof linearAgentSessionWebhookActions)[number];
export type LinearAgentSessionWebhookEventName =
  (typeof linearAgentSessionWebhookEventNames)[number];
export type LinearWebhookEventName = (typeof linearWebhookEventNames)[number];

const linearWebhookDataSchema = z.record(z.string(), z.unknown());
const linearWebhookAgentSessionSchema = z.record(z.string(), z.unknown());

const linearWebhookDataEnvelopeSchema = z.object({
  action: z.enum(linearWebhookActions),
  type: z.enum(linearWebhookResourceTypes),
  organizationId: z.string().min(1),
  webhookTimestamp: z.number().int(),
  data: linearWebhookDataSchema,
});

const linearWebhookDataBaseEnvelopeSchema = z.object({
  action: z.string().min(1),
  type: z.string().min(1),
  organizationId: z.string().min(1),
  webhookTimestamp: z.number().int(),
  data: linearWebhookDataSchema,
});
export const linearAgentSessionWebhookBaseEnvelopeSchema = z.object({
  action: z.string().min(1),
  type: z.literal('AgentSessionEvent'),
  organizationId: z.string().min(1),
  appUserId: z.string().min(1),
  webhookTimestamp: z.number().int(),
  agentSession: linearWebhookAgentSessionSchema,
});
export type LinearAgentSessionWebhookBaseEnvelopeDto = z.infer<
  typeof linearAgentSessionWebhookBaseEnvelopeSchema
>;

export const linearAgentSessionWebhookEnvelopeSchema =
  linearAgentSessionWebhookBaseEnvelopeSchema.extend({
    action: z.enum(linearAgentSessionWebhookActions),
  });
export type LinearAgentSessionWebhookEnvelopeDto = z.infer<
  typeof linearAgentSessionWebhookEnvelopeSchema
>;

export const linearWebhookEnvelopeSchema = z.union([
  linearWebhookDataEnvelopeSchema,
  linearAgentSessionWebhookEnvelopeSchema,
]);
export type LinearWebhookEnvelopeDto = z.infer<typeof linearWebhookEnvelopeSchema>;

export const linearWebhookBaseEnvelopeSchema = z.union([
  linearWebhookDataBaseEnvelopeSchema,
  linearAgentSessionWebhookBaseEnvelopeSchema,
]);
export type LinearWebhookBaseEnvelopeDto = z.infer<typeof linearWebhookBaseEnvelopeSchema>;

export const createLinearInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateLinearInstallBodyDto = z.infer<typeof createLinearInstallBodySchema>;

export const createLinearInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateLinearInstallResponseDto = z.infer<typeof createLinearInstallResponseSchema>;

export const linearCallbackQuerySchema = z.union([
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
export type LinearCallbackQueryDto = z.infer<typeof linearCallbackQuerySchema>;

export const linearCallbackResponseSchema = integrationConnectionDtoSchema;
export type LinearCallbackResponseDto = z.infer<typeof linearCallbackResponseSchema>;

export const createE2eLinearConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  organization_id: z.string().min(1),
  organization_url_key: z.string().min(1),
  app_user_id: z.string().min(1),
  display_name: z.string().min(1),
  access_token: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1).default(['read', 'write']),
});
export type CreateE2eLinearConnectionBodyDto = z.infer<typeof createE2eLinearConnectionBodySchema>;

export const createE2eLinearConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eLinearConnectionResponseDto = z.infer<
  typeof createE2eLinearConnectionResponseSchema
>;
