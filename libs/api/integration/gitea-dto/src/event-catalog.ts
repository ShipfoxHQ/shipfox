import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {giteaWebhookEventNames} from './schemas/index.js';

const eventSummaries = {
  push: 'A Gitea repository receives one or more commits.',
} as const satisfies Record<(typeof giteaWebhookEventNames)[number], string>;

export const giteaEventCatalog = {
  provider: 'Gitea',
  families: [
    {
      key: 'push',
      title: 'Push',
      summary: 'Commits pushed to a branch or tag in the connected organization.',
      payloadKind: 'raw-provider',
    },
  ],
  events: giteaWebhookEventNames.map((name) => ({
    name,
    family: 'push',
    summary: eventSummaries[name],
  })),
} as const satisfies IntegrationEventCatalog;
