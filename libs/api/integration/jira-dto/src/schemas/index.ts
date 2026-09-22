import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const JIRA_PROVIDER = 'jira';
export type JiraProvider = typeof JIRA_PROVIDER;

export const jiraIssueWebhookEventNames = [
  'jira:issue_created',
  'jira:issue_updated',
  'jira:issue_deleted',
] as const;
export const jiraCommentWebhookEventNames = [
  'comment_created',
  'comment_updated',
  'comment_deleted',
] as const;
export const jiraWebhookEventNames = [
  ...jiraIssueWebhookEventNames,
  ...jiraCommentWebhookEventNames,
] as const;

export const jiraWebhookEventNameSchema = z.enum(jiraWebhookEventNames);
export type JiraIssueWebhookEventName = (typeof jiraIssueWebhookEventNames)[number];
export type JiraCommentWebhookEventName = (typeof jiraCommentWebhookEventNames)[number];
export type JiraWebhookEventName = z.infer<typeof jiraWebhookEventNameSchema>;

export const jiraWebhookUserSchema = z
  .object({
    accountId: z.string().min(1).describe('Atlassian account ID of the user.'),
    displayName: z.string().min(1).optional().describe('Display name of the user.'),
  })
  .passthrough();
export type JiraWebhookUserDto = z.infer<typeof jiraWebhookUserSchema>;

const jiraWebhookNamedResourceSchema = z
  .object({
    id: z.string().min(1).optional().describe('Jira ID of the resource.'),
    name: z.string().min(1).optional().describe('Display name of the resource.'),
  })
  .passthrough();

export const jiraWebhookIssueSchema = z
  .object({
    id: z.string().min(1).describe('Jira issue ID.'),
    key: z.string().min(1).describe('Issue key, such as ENG-123.'),
    fields: z
      .object({
        summary: z.string().optional().describe('Issue summary.'),
        status: jiraWebhookNamedResourceSchema
          .nullable()
          .optional()
          .describe('Current issue status.'),
        assignee: jiraWebhookUserSchema.nullable().optional().describe('Current assignee.'),
      })
      .passthrough()
      .describe('Current issue fields returned by Jira.'),
  })
  .passthrough();
export type JiraWebhookIssueDto = z.infer<typeof jiraWebhookIssueSchema>;

const jiraWebhookChangelogItemSchema = z
  .object({
    field: z.string().min(1).describe('Display name of the changed field.'),
    fieldtype: z.string().min(1).optional().describe('Field type, such as jira.'),
    fieldId: z.string().min(1).optional().describe('Field ID, such as status.'),
    from: z.string().nullable().optional().describe('Previous value ID.'),
    fromString: z.string().nullable().optional().describe('Previous value as displayed.'),
    to: z.string().nullable().optional().describe('New value ID.'),
    toString: z.string().nullable().optional().describe('New value as displayed.'),
  })
  .passthrough();

export const jiraWebhookChangelogSchema = z
  .object({
    id: z.string().min(1).optional().describe('Changelog entry ID.'),
    items: z.array(jiraWebhookChangelogItemSchema).describe('Fields that changed.'),
  })
  .passthrough();
export type JiraWebhookChangelogDto = z.infer<typeof jiraWebhookChangelogSchema>;

export const jiraWebhookCommentSchema = z
  .object({
    id: z.string().min(1).describe('Comment ID.'),
    author: jiraWebhookUserSchema.describe('Comment author.'),
    body: z.unknown().describe('Comment body in the Atlassian document format.'),
  })
  .passthrough();
export type JiraWebhookCommentDto = z.infer<typeof jiraWebhookCommentSchema>;

export const jiraWebhookBaseEnvelopeSchema = z
  .object({
    webhookEvent: z.string().min(1).describe('Jira webhook event name.'),
    timestamp: z.number().int().describe('Event time supplied by Jira, in milliseconds.'),
    issue: jiraWebhookIssueSchema.describe('The affected issue.'),
    user: jiraWebhookUserSchema.describe('The user who performed the action.'),
    matchedWebhookIds: z
      .array(z.number().int().positive())
      .optional()
      .describe('IDs of the Jira webhooks that matched the event.'),
  })
  .passthrough();
export type JiraWebhookBaseEnvelopeDto = z.infer<typeof jiraWebhookBaseEnvelopeSchema>;

export const jiraIssueWebhookEnvelopeSchema = jiraWebhookBaseEnvelopeSchema.extend({
  webhookEvent: z.enum(jiraIssueWebhookEventNames).describe('Jira webhook event name.'),
  issue_event_type_name: z
    .string()
    .min(1)
    .describe('Finer-grained issue event type, such as issue_assigned.'),
  changelog: jiraWebhookChangelogSchema
    .optional()
    .describe('Fields that changed. Present on updates.'),
});
export type JiraIssueWebhookEnvelopeDto = z.infer<typeof jiraIssueWebhookEnvelopeSchema>;

export const jiraCommentWebhookEnvelopeSchema = jiraWebhookBaseEnvelopeSchema.extend({
  webhookEvent: z.enum(jiraCommentWebhookEventNames).describe('Jira webhook event name.'),
  comment: jiraWebhookCommentSchema.describe('The affected comment.'),
});
export type JiraCommentWebhookEnvelopeDto = z.infer<typeof jiraCommentWebhookEnvelopeSchema>;

export const jiraWebhookEnvelopeSchema = z.discriminatedUnion('webhookEvent', [
  jiraIssueWebhookEnvelopeSchema,
  jiraCommentWebhookEnvelopeSchema,
]);
export type JiraWebhookEnvelopeDto = z.infer<typeof jiraWebhookEnvelopeSchema>;

const jiraCloudIdSchema = z
  .string()
  .min(1)
  .describe('Cloud ID of the connected Jira site, added by Shipfox.');

export const jiraIssueEventPayloadSchema = jiraIssueWebhookEnvelopeSchema.extend({
  cloudId: jiraCloudIdSchema,
});
export type JiraIssueEventPayloadDto = z.infer<typeof jiraIssueEventPayloadSchema>;

export const jiraCommentEventPayloadSchema = jiraCommentWebhookEnvelopeSchema.extend({
  cloudId: jiraCloudIdSchema,
});
export type JiraCommentEventPayloadDto = z.infer<typeof jiraCommentEventPayloadSchema>;

export const jiraEventPayloadSchema = z.discriminatedUnion('webhookEvent', [
  jiraIssueEventPayloadSchema,
  jiraCommentEventPayloadSchema,
]);
export type JiraEventPayloadDto = z.infer<typeof jiraEventPayloadSchema>;

export const createJiraInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateJiraInstallBodyDto = z.infer<typeof createJiraInstallBodySchema>;

export const createJiraInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateJiraInstallResponseDto = z.infer<typeof createJiraInstallResponseSchema>;

export const jiraCallbackQuerySchema = z.union([
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
export type JiraCallbackQueryDto = z.infer<typeof jiraCallbackQuerySchema>;

export const jiraAccessibleResourceSchema = z.object({
  cloud_id: jiraCloudIdSchema,
  name: z.string().min(1),
  url: z.string().url(),
  scopes: z.array(z.string().min(1)),
});
export type JiraAccessibleResourceDto = z.infer<typeof jiraAccessibleResourceSchema>;

export const jiraAccessibleResourcesSchema = z.array(jiraAccessibleResourceSchema);
export type JiraAccessibleResourcesDto = z.infer<typeof jiraAccessibleResourcesSchema>;

export const jiraSiteSelectionResponseSchema = z.object({
  sites: jiraAccessibleResourcesSchema.min(2),
});
export type JiraSiteSelectionResponseDto = z.infer<typeof jiraSiteSelectionResponseSchema>;

export const completeJiraSiteSelectionBodySchema = z.object({
  cloud_id: jiraCloudIdSchema,
  state: z.string().min(1),
});
export type CompleteJiraSiteSelectionBodyDto = z.infer<typeof completeJiraSiteSelectionBodySchema>;

export const jiraCallbackResponseSchema = z.union([
  integrationConnectionDtoSchema,
  jiraSiteSelectionResponseSchema,
]);
export type JiraCallbackResponseDto = z.infer<typeof jiraCallbackResponseSchema>;
