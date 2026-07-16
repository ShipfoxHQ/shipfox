import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';

const githubWebhookPayloadDocsUrl =
  'https://docs.github.com/en/webhooks/webhook-events-and-payloads';

export const githubEventCatalog = {
  provider: 'GitHub',
  passthrough: true,
  upstreamEventsDocUrl: githubWebhookPayloadDocsUrl,
  events: [
    {
      name: 'push',
      summary: 'A Git reference receives one or more commits.',
      emittedWhen: 'GitHub sends a push webhook to the connected GitHub App.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'pull_request.opened',
      summary: 'A pull request opens.',
      emittedWhen: 'GitHub sends a pull_request webhook with the opened action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'pull_request.closed',
      summary: 'A pull request closes or merges.',
      emittedWhen: 'GitHub sends a pull_request webhook with the closed action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'pull_request.synchronize',
      summary: 'A pull request head branch receives commits.',
      emittedWhen: 'GitHub sends a pull_request webhook with the synchronize action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'pull_request.reopened',
      summary: 'A closed pull request reopens.',
      emittedWhen: 'GitHub sends a pull_request webhook with the reopened action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'issues.opened',
      summary: 'An issue opens.',
      emittedWhen: 'GitHub sends an issues webhook with the opened action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'issues.closed',
      summary: 'An issue closes.',
      emittedWhen: 'GitHub sends an issues webhook with the closed action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'issues.reopened',
      summary: 'A closed issue reopens.',
      emittedWhen: 'GitHub sends an issues webhook with the reopened action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'issues.edited',
      summary: 'An issue title or body changes.',
      emittedWhen: 'GitHub sends an issues webhook with the edited action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'issues.labeled',
      summary: 'A label is added to an issue.',
      emittedWhen: 'GitHub sends an issues webhook with the labeled action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'issues.unlabeled',
      summary: 'A label is removed from an issue.',
      emittedWhen: 'GitHub sends an issues webhook with the unlabeled action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
    {
      name: 'release.published',
      summary: 'A release is published.',
      emittedWhen: 'GitHub sends a release webhook with the published action.',
      payloadKind: 'raw-provider',
      payloadDocUrl: githubWebhookPayloadDocsUrl,
    },
  ],
} as const satisfies IntegrationEventCatalog;
