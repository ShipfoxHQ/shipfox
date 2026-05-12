import {log, proxyActivities} from '@temporalio/workflow';
import type {createProjectsMaintenanceActivities} from '../activities/index.js';

const {pruneIntegrationEventDedupActivity} = proxyActivities<
  ReturnType<typeof createProjectsMaintenanceActivities>
>({
  startToCloseTimeout: '5 minutes',
});

export async function pruneIntegrationEventDedupCron(): Promise<void> {
  const {deleted} = await pruneIntegrationEventDedupActivity();
  if (deleted > 0) {
    log.info('Pruned projects integration event dedup rows', {deleted});
  }
}
