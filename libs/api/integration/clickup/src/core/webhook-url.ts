export const CLICKUP_WEBHOOK_ROUTE_PREFIX = '/webhooks/integrations/clickup';

export function clickupWebhookUrl(connectionId: string): string {
  return `${CLICKUP_WEBHOOK_ROUTE_PREFIX}/${connectionId}`;
}
