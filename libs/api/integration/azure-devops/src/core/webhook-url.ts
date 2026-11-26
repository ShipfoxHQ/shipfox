import {config} from '#config.js';

export const AZURE_DEVOPS_WEBHOOK_ROUTE_PREFIX = '/webhooks/integrations/azure-devops';

const TRAILING_SLASHES_RE = /\/+$/;

export function azureDevOpsWebhookUrl(connectionId: string): string {
  const base = config.AZURE_DEVOPS_WEBHOOK_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  return `${base}${AZURE_DEVOPS_WEBHOOK_ROUTE_PREFIX}/${connectionId}`;
}
