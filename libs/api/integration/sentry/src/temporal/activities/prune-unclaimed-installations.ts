import {config} from '#config.js';
import {pruneUnclaimedSentryInstallations} from '#db/installations.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function pruneUnclaimedSentryInstallationsActivity(): Promise<{tombstoned: number}> {
  const olderThan = new Date(
    Date.now() - config.SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS * MS_PER_DAY,
  );
  return await pruneUnclaimedSentryInstallations({olderThan});
}
