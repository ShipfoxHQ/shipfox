import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {WEBHOOK_RECEIVED_EVENT} from './constants.js';

export const webhookEventCatalog = {
  provider: 'Custom webhook',
  events: [
    {
      name: WEBHOOK_RECEIVED_EVENT,
      summary: 'A custom webhook request is accepted.',
      emittedWhen: 'Shipfox accepts a request at the integration connection ingest URL.',
      payloadKind: 'shipfox-normalized',
    },
  ],
} as const satisfies IntegrationEventCatalog;
