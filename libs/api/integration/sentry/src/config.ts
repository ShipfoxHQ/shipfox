import {bool, createConfig, str} from '@shipfox/config';

export const config = createConfig({
  // CLIENT_ID and SLUG are not used by this webhook receiver; they are consumed by
  // the install/OAuth + app-token-exchange flow in the next PR. Declared now so the
  // app credential contract is defined once rather than toggled across PRs.
  SENTRY_APP_CLIENT_ID: str(),
  // Shared secret used to verify inbound webhook HMAC-SHA256 signatures (Sentry
  // signs deliveries with it, we verify them); also keys app token exchange later.
  SENTRY_APP_CLIENT_SECRET: str(),
  SENTRY_APP_SLUG: str(),
  SENTRY_APP_VERIFY_INSTALL: bool({default: true}),
});
