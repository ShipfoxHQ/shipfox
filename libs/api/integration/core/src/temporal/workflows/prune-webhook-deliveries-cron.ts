import {log, proxyActivities} from '@temporalio/workflow';
import type {createIntegrationsMaintenanceActivities} from '../activities/index.js';

const {pruneWebhookDeliveriesActivity} = proxyActivities<
  ReturnType<typeof createIntegrationsMaintenanceActivities>
>({
  startToCloseTimeout: '5 minutes',
});

export async function pruneWebhookDeliveriesCron(): Promise<void> {
  const {deleted} = await pruneWebhookDeliveriesActivity();
  if (deleted > 0) {
    log.info('Pruned integrations webhook deliveries', {deleted});
  }
}
