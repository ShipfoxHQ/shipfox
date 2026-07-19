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
    accountId: z.string().min(1),
    displayName: z.string().min(1).optional(),
  })
  .passthrough();
export type JiraWebhookUserDto = z.infer<typeof jiraWebhookUserSchema>;

const jiraWebhookNamedResourceSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .passthrough();

export const jiraWebhookIssueSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    fields: z
      .object({
        summary: z.string().optional(),
        status: jiraWebhookNamedResourceSchema.nullable().optional(),
        assignee: jiraWebhookUserSchema.nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type JiraWebhookIssueDto = z.infer<typeof jiraWebhookIssueSchema>;

const jiraWebhookChangelogItemSchema = z
  .object({
    field: z.string().min(1),
    fieldtype: z.string().min(1).optional(),
    fieldId: z.string().min(1).optional(),
    from: z.string().nullable().optional(),
    fromString: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
    toString: z.string().nullable().optional(),
  })
  .passthrough();

export const jiraWebhookChangelogSchema = z
  .object({
    id: z.string().min(1).optional(),
    items: z.array(jiraWebhookChangelogItemSchema),
  })
  .passthrough();
export type JiraWebhookChangelogDto = z.infer<typeof jiraWebhookChangelogSchema>;

export const jiraWebhookCommentSchema = z
  .object({
    id: z.string().min(1),
    author: jiraWebhookUserSchema,
    body: z.unknown(),
  })
  .passthrough();
export type JiraWebhookCommentDto = z.infer<typeof jiraWebhookCommentSchema>;

export const jiraWebhookBaseEnvelopeSchema = z
  .object({
    webhookEvent: z.string().min(1),
    timestamp: z.number().int(),
    issue: jiraWebhookIssueSchema,
    user: jiraWebhookUserSchema,
    matchedWebhookIds: z.array(z.number().int().positive()).optional(),
  })
  .passthrough();
export type JiraWebhookBaseEnvelopeDto = z.infer<typeof jiraWebhookBaseEnvelopeSchema>;

export const jiraIssueWebhookEnvelopeSchema = jiraWebhookBaseEnvelopeSchema.extend({
  webhookEvent: z.enum(jiraIssueWebhookEventNames),
  issue_event_type_name: z.string().min(1),
  changelog: jiraWebhookChangelogSchema.optional(),
});
export type JiraIssueWebhookEnvelopeDto = z.infer<typeof jiraIssueWebhookEnvelopeSchema>;

export const jiraCommentWebhookEnvelopeSchema = jiraWebhookBaseEnvelopeSchema.extend({
  webhookEvent: z.enum(jiraCommentWebhookEventNames),
  comment: jiraWebhookCommentSchema,
});
export type JiraCommentWebhookEnvelopeDto = z.infer<typeof jiraCommentWebhookEnvelopeSchema>;

export const jiraWebhookEnvelopeSchema = z.discriminatedUnion('webhookEvent', [
  jiraIssueWebhookEnvelopeSchema,
  jiraCommentWebhookEnvelopeSchema,
]);
export type JiraWebhookEnvelopeDto = z.infer<typeof jiraWebhookEnvelopeSchema>;

const jiraCloudIdSchema = z.string().min(1);

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
