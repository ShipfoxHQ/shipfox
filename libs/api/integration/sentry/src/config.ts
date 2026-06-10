import {bool, createConfig, str} from '@shipfox/config';

export const config = createConfig({
  SENTRY_APP_CLIENT_ID: str(),
  // Signs inbound webhooks (HMAC-SHA256) AND, in PR2, the token exchange.
  SENTRY_APP_CLIENT_SECRET: str(),
  SENTRY_APP_SLUG: str(),
  SENTRY_APP_VERIFY_INSTALL: bool({default: true}),
});
