import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const CLICKUP_PROVIDER = 'clickup';
export type ClickUpProvider = typeof CLICKUP_PROVIDER;

export const clickupWebhookEventNames = [
  'taskCreated',
  'taskUpdated',
  'taskDeleted',
  'taskMoved',
  'taskStatusUpdated',
  'taskAssigneeUpdated',
  'taskPriorityUpdated',
  'taskDueDateUpdated',
  'taskTagUpdated',
  'taskCommentPosted',
  'taskCommentUpdated',
] as const;
export const clickupEventNames = clickupWebhookEventNames;

export const clickupTaskWebhookEventNames = [
  'taskCreated',
  'taskUpdated',
  'taskMoved',
  'taskStatusUpdated',
  'taskAssigneeUpdated',
  'taskPriorityUpdated',
  'taskDueDateUpdated',
  'taskTagUpdated',
] as const;
export const clickupCommentWebhookEventNames = ['taskCommentPosted', 'taskCommentUpdated'] as const;

export const clickupWebhookEventNameSchema = z.enum(clickupWebhookEventNames);
export const clickupEventNameSchema = clickupWebhookEventNameSchema;
export type ClickUpWebhookEventName = z.infer<typeof clickupWebhookEventNameSchema>;
export type ClickUpEventName = ClickUpWebhookEventName;

export const clickupWebhookUserSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int()]),
    username: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    initials: z.string().min(1).optional(),
  })
  .passthrough();
export type ClickUpWebhookUserDto = z.infer<typeof clickupWebhookUserSchema>;

export const clickupWebhookCommentSchema = z
  .object({
    id: z.string().min(1),
    text_content: z.string().optional(),
    comment: z.unknown(),
    user: clickupWebhookUserSchema,
    assignee: clickupWebhookUserSchema.nullable().optional(),
    assigned_by: clickupWebhookUserSchema.nullable().optional(),
    date: z.string().min(1),
  })
  .passthrough();
export type ClickUpWebhookCommentDto = z.infer<typeof clickupWebhookCommentSchema>;

export const clickupWebhookHistoryItemSchema = z
  .object({
    id: z.string().min(1),
    type: z.union([z.string().min(1), z.number().int()]),
    date: z.string().min(1),
    field: z.string().min(1),
    parent_id: z.string().min(1),
    data: z.unknown(),
    source: z.unknown(),
    user: clickupWebhookUserSchema,
    before: z.unknown(),
    after: z.unknown(),
  })
  .passthrough();
export type ClickUpWebhookHistoryItemDto = z.infer<typeof clickupWebhookHistoryItemSchema>;

export const clickupWebhookCommentHistoryItemSchema = clickupWebhookHistoryItemSchema
  .extend({comment: clickupWebhookCommentSchema})
  .passthrough();
export type ClickUpWebhookCommentHistoryItemDto = z.infer<
  typeof clickupWebhookCommentHistoryItemSchema
>;

const clickupWebhookBaseEnvelopeFields = {
  event: z.string().min(1),
  webhook_id: z.string().min(1),
  task_id: z.string().min(1),
};

export const clickupWebhookBaseEnvelopeSchema = z
  .object({
    ...clickupWebhookBaseEnvelopeFields,
    history_items: z.array(clickupWebhookHistoryItemSchema).optional(),
  })
  .passthrough();
export type ClickUpWebhookBaseEnvelopeDto = z.infer<typeof clickupWebhookBaseEnvelopeSchema>;

export const clickupTaskWebhookEnvelopeSchema = z
  .object({
    ...clickupWebhookBaseEnvelopeFields,
    event: z.enum(clickupTaskWebhookEventNames),
    history_items: z.array(clickupWebhookHistoryItemSchema),
  })
  .passthrough();
export type ClickUpTaskWebhookEnvelopeDto = z.infer<typeof clickupTaskWebhookEnvelopeSchema>;

export const clickupCommentWebhookEnvelopeSchema = z
  .object({
    ...clickupWebhookBaseEnvelopeFields,
    event: z.enum(clickupCommentWebhookEventNames),
    history_items: z.array(clickupWebhookCommentHistoryItemSchema),
  })
  .passthrough();
export type ClickUpCommentWebhookEnvelopeDto = z.infer<typeof clickupCommentWebhookEnvelopeSchema>;

export const clickupTaskDeletedWebhookEnvelopeSchema = z
  .object({
    ...clickupWebhookBaseEnvelopeFields,
    event: z.literal('taskDeleted'),
  })
  .passthrough();
export type ClickUpTaskDeletedWebhookEnvelopeDto = z.infer<
  typeof clickupTaskDeletedWebhookEnvelopeSchema
>;

export const clickupWebhookEnvelopeSchema = z.discriminatedUnion('event', [
  clickupTaskWebhookEnvelopeSchema,
  clickupCommentWebhookEnvelopeSchema,
  clickupTaskDeletedWebhookEnvelopeSchema,
]);
export type ClickUpWebhookEnvelopeDto = z.infer<typeof clickupWebhookEnvelopeSchema>;

const clickupTeamIdSchema = z.string().min(1);

export const clickupTaskEventPayloadSchema = clickupTaskWebhookEnvelopeSchema
  .extend({team_id: clickupTeamIdSchema})
  .passthrough();
export type ClickUpTaskEventPayloadDto = z.infer<typeof clickupTaskEventPayloadSchema>;

export const clickupCommentEventPayloadSchema = clickupCommentWebhookEnvelopeSchema
  .extend({team_id: clickupTeamIdSchema})
  .passthrough();
export type ClickUpCommentEventPayloadDto = z.infer<typeof clickupCommentEventPayloadSchema>;

export const clickupTaskDeletedEventPayloadSchema = clickupTaskDeletedWebhookEnvelopeSchema
  .extend({team_id: clickupTeamIdSchema})
  .passthrough();
export type ClickUpTaskDeletedEventPayloadDto = z.infer<
  typeof clickupTaskDeletedEventPayloadSchema
>;

export const clickupEventPayloadSchema = z.discriminatedUnion('event', [
  clickupTaskEventPayloadSchema,
  clickupCommentEventPayloadSchema,
  clickupTaskDeletedEventPayloadSchema,
]);
export type ClickUpEventPayloadDto = z.infer<typeof clickupEventPayloadSchema>;

export const createClickUpInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateClickUpInstallBodyDto = z.infer<typeof createClickUpInstallBodySchema>;

export const createClickUpInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateClickUpInstallResponseDto = z.infer<typeof createClickUpInstallResponseSchema>;

export const clickupCallbackQuerySchema = z.union([
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
export type ClickUpCallbackQueryDto = z.infer<typeof clickupCallbackQuerySchema>;

export const clickupCallbackResponseSchema = integrationConnectionDtoSchema;
export type ClickUpCallbackResponseDto = z.infer<typeof clickupCallbackResponseSchema>;

export const createE2eClickUpConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  team_id: z.string().min(1),
  team_name: z.string().min(1),
  authorizing_user_id: z.string().min(1),
  access_token: z.string().min(1),
  webhook_id: z.string().min(1),
  webhook_secret: z.string().min(1),
  display_name: z.string().min(1),
});
export type CreateE2eClickUpConnectionBodyDto = z.infer<
  typeof createE2eClickUpConnectionBodySchema
>;

export const createE2eClickUpConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eClickUpConnectionResponseDto = z.infer<
  typeof createE2eClickUpConnectionResponseSchema
>;
