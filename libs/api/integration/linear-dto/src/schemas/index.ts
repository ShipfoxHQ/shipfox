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

export const linearWebhookEventNames = linearWebhookResourceTypes.flatMap((type) =>
  linearWebhookActions.map((action) => `${type}.${action}` as const),
);

export type LinearWebhookResourceType = (typeof linearWebhookResourceTypes)[number];
export type LinearWebhookAction = (typeof linearWebhookActions)[number];
export type LinearWebhookEventName = (typeof linearWebhookEventNames)[number];

const linearWebhookDataSchema = z.record(z.string(), z.unknown());

export const linearWebhookEnvelopeSchema = z.object({
  action: z.enum(linearWebhookActions),
  type: z.enum(linearWebhookResourceTypes),
  organizationId: z.string().min(1),
  webhookTimestamp: z.number().int(),
  data: linearWebhookDataSchema,
});
export type LinearWebhookEnvelopeDto = z.infer<typeof linearWebhookEnvelopeSchema>;

export const linearWebhookBaseEnvelopeSchema = z.object({
  action: z.string().min(1),
  type: z.string().min(1),
  organizationId: z.string().min(1),
  webhookTimestamp: z.number().int(),
  data: linearWebhookDataSchema,
});
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
