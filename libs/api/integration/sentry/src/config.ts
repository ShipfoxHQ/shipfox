import {bool, createConfig, str} from '@shipfox/config';

export const config = createConfig({
  // CLIENT_ID and SLUG are not used by this webhook receiver; they are consumed by
  // the install/OAuth + app-token-exchange flow in the next PR. Declared now so the
  // app credential contract is defined once rather than toggled across PRs.
  SENTRY_APP_CLIENT_ID: str(),
  // Signs inbound webhooks with HMAC-SHA256 (and keys app token exchange later).
  SENTRY_APP_CLIENT_SECRET: str(),
  SENTRY_APP_SLUG: str(),
  SENTRY_APP_VERIFY_INSTALL: bool({default: true}),
});
