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
    comment: z.unknown().describe('Rich comment blocks as ClickUp sends them.'),
    user: clickupWebhookUserSchema.describe('Comment author.'),
    assignee: clickupWebhookUserSchema
      .nullable()
      .optional()
      .describe('User the comment is assigned to.'),
    assigned_by: clickupWebhookUserSchema
      .nullable()
      .optional()
      .describe('User who assigned the comment.'),
    date: z.string().min(1).describe('Comment time in epoch milliseconds.'),
  })
  .passthrough();
export type ClickUpWebhookCommentDto = z.infer<typeof clickupWebhookCommentSchema>;

export const clickupWebhookHistoryItemSchema = z
  .object({
    id: z.string().min(1),
    type: z.union([z.string().min(1), z.number().int()]),
    date: z.string().min(1).describe('Change time in epoch milliseconds.'),
    field: z.string().min(1).describe('Changed field, such as status.'),
    parent_id: z.string().min(1).describe('ID of the List that contains the task.'),
    data: z.unknown(),
    source: z.unknown(),
    user: clickupWebhookUserSchema.describe('User who made the change.'),
    before: z.unknown().describe('State of the task field before the change.'),
    after: z.unknown().describe('State of the task field after the change.'),
  })
  .passthrough();
export type ClickUpWebhookHistoryItemDto = z.infer<typeof clickupWebhookHistoryItemSchema>;

export const clickupWebhookCommentHistoryItemSchema = clickupWebhookHistoryItemSchema
  .extend({comment: clickupWebhookCommentSchema.describe('The posted or updated comment.')})
  .passthrough();
export type ClickUpWebhookCommentHistoryItemDto = z.infer<
  typeof clickupWebhookCommentHistoryItemSchema
>;

const clickupWebhookBaseEnvelopeFields = {
  event: z.string().min(1),
  webhook_id: z.string().min(1).describe('ClickUp webhook that delivered the event.'),
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
    history_items: z
      .array(clickupWebhookHistoryItemSchema)
      .min(1)
      .describe('Change records supplied by ClickUp.'),
  })
  .passthrough();
export type ClickUpTaskWebhookEnvelopeDto = z.infer<typeof clickupTaskWebhookEnvelopeSchema>;

export const clickupCommentWebhookEnvelopeSchema = z
  .object({
    ...clickupWebhookBaseEnvelopeFields,
    event: z.enum(clickupCommentWebhookEventNames),
    history_items: z
      .array(clickupWebhookCommentHistoryItemSchema)
      .min(1)
      .describe('Change records supplied by ClickUp, each carrying the comment.'),
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

const clickupTeamIdSchema = z
  .string()
  .min(1)
  .describe('ID of the configured ClickUp workspace, added by Shipfox.');

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
