import {WEBHOOK_FORWARDED_HEADERS} from '@shipfox/api-integration-webhook-dto';

export {WEBHOOK_FORWARDED_HEADERS};

export const WEBHOOK_INBOUND_BODY_LIMIT = 1 * 1024 * 1024;

export const WEBHOOK_ACCEPTED_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'text/plain',
] as const;

const forwardedHeaderSet = new Set<string>(WEBHOOK_FORWARDED_HEADERS);

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const redacted: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    redacted[name] = forwardedHeaderSet.has(name.toLowerCase()) ? value : '[redacted]';
  }
  return redacted;
}
