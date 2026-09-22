import {RESERVED_CONNECTION_SLUGS} from '@shipfox/api-integration-core-dto';

export const WEBHOOK_PROVIDER = 'webhook' as const;
export const WEBHOOK_RECEIVED_EVENT = 'received' as const;

export const WEBHOOK_FORWARDED_HEADERS = [
  'content-type',
  'user-agent',
  'x-delivery-id',
  'x-request-id',
] as const;

export const WEBHOOK_RESERVED_SLUGS = [
  'github',
  'gitea',
  'sentry',
  ...RESERVED_CONNECTION_SLUGS,
] as const;
