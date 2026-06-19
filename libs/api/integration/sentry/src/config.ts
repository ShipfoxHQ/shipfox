import {bool, createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  SENTRY_APP_CLIENT_ID: str({
    desc: 'OAuth client ID of the Sentry app. Reserved for the install and app-token-exchange flow; the webhook receiver does not read it yet. Required.',
  }),
  SENTRY_APP_CLIENT_SECRET: str({
    desc: 'Shared secret used to verify the HMAC-SHA256 signature on inbound Sentry webhooks. Must match the value set on the Sentry app. Required.',
  }),
  SENTRY_APP_SLUG: str({
    desc: 'URL slug of the Sentry app, used to build install and callback links. Required.',
  }),
  SENTRY_APP_VERIFY_INSTALL: bool({
    desc: 'Verifies the signature on Sentry app installation requests. Keep it true; turn it off only for local testing.',
    default: true,
  }),
  SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS: num({
    desc: 'How many days a verified-but-unclaimed Sentry installation may sit before the daily cleanup cron tombstones it. A reinstall always mints a fresh uuid, so a tombstone is never revived. Defaults to 7.',
    default: 7,
  }),
});
