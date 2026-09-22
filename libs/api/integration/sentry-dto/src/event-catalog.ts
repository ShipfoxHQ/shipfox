import {
  eventPayloadJsonSchema,
  type IntegrationEventCatalog,
  SENTRY_ISSUE_ACTIONS,
} from '@shipfox/api-integration-core-dto';
import {sentryIssueEventPayloadSchema} from './schemas/index.js';

const sentryIssueWebhookDocsUrl =
  'https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/';

const sentryIssueActionSummaries = {
  created: 'A Sentry issue is created.',
  resolved: 'A Sentry issue is resolved.',
  assigned: 'A Sentry issue is assigned.',
  archived: 'A Sentry issue is archived.',
  unresolved: 'A resolved Sentry issue becomes unresolved.',
} as const satisfies Record<(typeof SENTRY_ISSUE_ACTIONS)[number], string>;

export const sentryEventCatalog = {
  provider: 'Sentry',
  families: [
    {
      key: 'issue',
      title: 'Issues',
      summary: 'Changes to a Sentry issue. Your workflow receives the issue fields listed below.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(sentryIssueEventPayloadSchema),
      payloadDocUrl: sentryIssueWebhookDocsUrl,
      notes: ['When Sentry sends the `ignored` action, Shipfox reports it as `issue.archived`.'],
    },
  ],
  events: SENTRY_ISSUE_ACTIONS.map((action) => ({
    name: `issue.${action}`,
    family: 'issue',
    summary: sentryIssueActionSummaries[action],
  })),
} as const satisfies IntegrationEventCatalog;
