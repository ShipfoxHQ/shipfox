import {SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS} from '#temporal/constants.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function pruneUnclaimedSentryInstallationsActivity(): Promise<{tombstoned: number}> {
  // Imported dynamically so loading the activity registry never pulls in the
  // Sentry package's config: this cron is only scheduled when Sentry is enabled,
  // and the import resolves its env then (mirrors core's provider loading).
  const {pruneUnclaimedSentryInstallations} = await import('@shipfox/api-integration-sentry');
  const olderThan = new Date(
    Date.now() - SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS * MS_PER_DAY,
  );
  return await pruneUnclaimedSentryInstallations({olderThan});
}
