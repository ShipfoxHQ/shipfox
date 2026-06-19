import {log, proxyActivities} from '@temporalio/workflow';
import type {createSentryMaintenanceActivities} from '../activities/index.js';

const {pruneUnclaimedSentryInstallationsActivity} = proxyActivities<
  ReturnType<typeof createSentryMaintenanceActivities>
>({
  startToCloseTimeout: '5 minutes',
});

export async function pruneUnclaimedSentryInstallationsCron(): Promise<void> {
  const {tombstoned} = await pruneUnclaimedSentryInstallationsActivity();
  if (tombstoned > 0) {
    log.info('Tombstoned stale unclaimed Sentry installations', {tombstoned});
  }
}
