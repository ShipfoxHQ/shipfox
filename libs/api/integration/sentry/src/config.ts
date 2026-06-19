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
    desc: 'How many days a verified-but-unclaimed Sentry installation may sit before the daily cleanup cron tombstones it. Must be at least 1; a smaller value moves the cutoff to now or the future and would tombstone freshly created, still-unclaimed installs. A reinstall always mints a fresh uuid, so a tombstone is never revived. Defaults to 7.',
    default: 7,
  }),
});

// The daily cleanup cron tombstones every unclaimed install older than
// `now - SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS`. A value below 1 moves that
// cutoff to now or the future, which would wipe freshly created installs nobody has
// claimed yet. Reject it at startup rather than let the 04:00 cron fail silently.
export function assertRetentionDaysWithinBounds(days: number): void {
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(
      `SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS must be a finite number of at least 1, received ${days}.`,
    );
  }
}

assertRetentionDaysWithinBounds(config.SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS);
