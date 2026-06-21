import {log, proxyActivities} from '@temporalio/workflow';
import type {createTriggersMaintenanceActivities} from '../activities/index.js';

const {pruneTriggerEventsActivity} = proxyActivities<
  ReturnType<typeof createTriggersMaintenanceActivities>
>({
  startToCloseTimeout: '5 minutes',
  // Let persistent failures fall through so the next hourly run retries with a fresh cutoff.
  retry: {maximumAttempts: 5},
});

export async function pruneTriggerEventsCron(): Promise<void> {
  const {deleted} = await pruneTriggerEventsActivity();
  if (deleted > 0) {
    log.info('Pruned trigger received events', {deleted});
  }
}
