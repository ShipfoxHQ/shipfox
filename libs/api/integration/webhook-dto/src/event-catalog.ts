import {
  eventPayloadJsonSchema,
  type IntegrationEventCatalog,
} from '@shipfox/api-integration-core-dto';
import {WEBHOOK_RECEIVED_EVENT} from './constants.js';
import {webhookReceivedEventPayloadSchema} from './event-payload.js';

export const webhookEventCatalog = {
  provider: 'Custom webhook',
  families: [
    {
      key: 'request',
      title: 'Requests',
      summary:
        'Requests sent to your custom webhook URL. Your workflow receives the method, headers, query, and body.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(webhookReceivedEventPayloadSchema),
    },
  ],
  events: [
    {
      name: WEBHOOK_RECEIVED_EVENT,
      family: 'request',
      summary: 'A custom webhook request is accepted.',
    },
  ],
} as const satisfies IntegrationEventCatalog;
