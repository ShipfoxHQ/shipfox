import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('integrations');

export type ClickUpWebhookDeliveryOutcome =
  | 'processed'
  | 'duplicate'
  | 'discarded'
  | 'connection_unavailable'
  | 'invalid_signature'
  | 'malformed_payload';

const clickupWebhookDeliveries = meter.createCounter<{
  outcome: ClickUpWebhookDeliveryOutcome;
}>('integrations_clickup_webhook_deliveries', {
  description: 'ClickUp webhook deliveries by bounded processing outcome',
});

export function recordClickUpWebhookDelivery(outcome: ClickUpWebhookDeliveryOutcome): void {
  try {
    clickupWebhookDeliveries.add(1, {outcome});
  } catch {
    // Metrics must not affect webhook delivery outcomes.
  }
}
