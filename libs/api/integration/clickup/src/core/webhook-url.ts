import {config} from '#config.js';

export const CLICKUP_WEBHOOK_ROUTE_PREFIX = '/webhooks/integrations/clickup';

const TRAILING_SLASHES_RE = /\/+$/;

export function clickupWebhookUrl(connectionId: string): string {
  return `${config.CLICKUP_WEBHOOK_BASE_URL.replace(TRAILING_SLASHES_RE, '')}${CLICKUP_WEBHOOK_ROUTE_PREFIX}/${connectionId}`;
}
