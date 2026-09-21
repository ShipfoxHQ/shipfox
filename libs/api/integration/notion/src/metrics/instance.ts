import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('integrations');

export type NotionWebhookDeliveryOutcome =
  | 'handshake'
  | 'processed'
  | 'duplicate'
  | 'unsupported_event'
  | 'connection_unavailable'
  | 'grant_visibility_discarded'
  | 'invalid_signature'
  | 'malformed_payload';

const notionWebhookDeliveries = meter.createCounter<{
  outcome: NotionWebhookDeliveryOutcome;
}>('integrations_notion_webhook_deliveries', {
  description: 'Notion webhook deliveries by bounded processing outcome',
});

export function recordNotionWebhookDelivery(outcome: NotionWebhookDeliveryOutcome): void {
  try {
    notionWebhookDeliveries.add(1, {outcome});
  } catch {
    // Metrics must not affect webhook delivery outcomes.
  }
}
