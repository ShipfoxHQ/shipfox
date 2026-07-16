import {
  type IntegrationEventCatalog,
  SENTRY_ISSUE_ACTIONS,
} from '@shipfox/api-integration-core-dto';

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
  events: SENTRY_ISSUE_ACTIONS.map((action) => ({
    name: `issue.${action}`,
    summary: sentryIssueActionSummaries[action],
    emittedWhen: `Sentry sends an issue webhook with the ${action} action.`,
    payloadKind: 'shipfox-normalized',
    payloadDocUrl: sentryIssueWebhookDocsUrl,
  })),
} as const satisfies IntegrationEventCatalog;
