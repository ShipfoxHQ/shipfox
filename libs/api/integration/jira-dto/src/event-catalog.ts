import {
  eventPayloadJsonSchema,
  type IntegrationEventCatalog,
} from '@shipfox/api-integration-core-dto';
import {
  jiraCommentEventPayloadSchema,
  jiraCommentWebhookEventNames,
  jiraIssueEventPayloadSchema,
  jiraWebhookEventNames,
} from './schemas/index.js';

const jiraWebhooksDocsUrl = 'https://developer.atlassian.com/cloud/jira/platform/webhooks/';

const eventSummaries = {
  'jira:issue_created': 'A Jira issue is created.',
  'jira:issue_updated': 'A Jira issue changes.',
  'jira:issue_deleted': 'A Jira issue is deleted.',
  comment_created: 'A comment is added to a Jira issue.',
  comment_updated: 'A comment on a Jira issue changes.',
  comment_deleted: 'A comment is deleted from a Jira issue.',
} as const satisfies Record<(typeof jiraWebhookEventNames)[number], string>;

const commentEvents = new Set<string>(jiraCommentWebhookEventNames);

export const jiraEventCatalog = {
  provider: 'Jira',
  families: [
    {
      key: 'issue',
      title: 'Issues',
      summary:
        'Changes to a Jira issue. Each event includes the issue with its current fields. Update events also list the changed fields.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(jiraIssueEventPayloadSchema),
      payloadDocUrl: jiraWebhooksDocsUrl,
      shipfoxFields: ['cloudId'],
    },
    {
      key: 'comment',
      title: 'Comments',
      summary:
        'Comments on a Jira issue. Each event includes the issue and the comment with its author and body.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(jiraCommentEventPayloadSchema),
      payloadDocUrl: jiraWebhooksDocsUrl,
      shipfoxFields: ['cloudId'],
    },
  ],
  events: jiraWebhookEventNames.map((name) => ({
    name,
    family: commentEvents.has(name) ? 'comment' : 'issue',
    summary: eventSummaries[name],
  })),
} as const satisfies IntegrationEventCatalog;
