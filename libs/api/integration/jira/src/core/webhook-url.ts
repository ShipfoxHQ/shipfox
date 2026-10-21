import {createHmac, timingSafeEqual} from 'node:crypto';
import {config} from '#config.js';

export const JIRA_WEBHOOK_ROUTE_PREFIX = '/webhooks/integrations/jira';

const TRAILING_SLASHES_RE = /\/+$/;

export function jiraWebhookDeliveryToken(connectionId: string): string {
  return createHmac('sha256', config.JIRA_OAUTH_CLIENT_SECRET)
    .update(`jira-webhook:${connectionId}`)
    .digest('base64url');
}

export function jiraWebhookUrl(connectionId: string): string {
  const base = `${config.JIRA_WEBHOOK_BASE_URL.replace(TRAILING_SLASHES_RE, '')}${JIRA_WEBHOOK_ROUTE_PREFIX}/${connectionId}`;
  return `${base}?delivery=${jiraWebhookDeliveryToken(connectionId)}`;
}

export function jiraWebhookDeliveryTokenMatches(
  connectionId: string,
  rawQueryString: string,
): boolean {
  const presented = new URLSearchParams(rawQueryString).get('delivery');
  if (!presented) return false;
  const expected = Buffer.from(jiraWebhookDeliveryToken(connectionId));
  const actual = Buffer.from(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
