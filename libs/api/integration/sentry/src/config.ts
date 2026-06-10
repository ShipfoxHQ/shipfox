import {bool, createConfig, str} from '@shipfox/config';

export const config = createConfig({
  SENTRY_APP_CLIENT_ID: str(),
  // Sentry uses the client secret for inbound webhook signatures and app token exchange.
  SENTRY_APP_CLIENT_SECRET: str(),
  SENTRY_APP_SLUG: str(),
  SENTRY_APP_VERIFY_INSTALL: bool({default: true}),
});
