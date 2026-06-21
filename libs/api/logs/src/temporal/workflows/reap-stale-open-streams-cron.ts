import {log, proxyActivities} from '@temporalio/workflow';
import type {createLogsActivities} from '../activities/index.js';

const {reapStaleOpenStreamsActivity} = proxyActivities<ReturnType<typeof createLogsActivities>>({
  startToCloseTimeout: '5 minutes',
});

export async function reapStaleOpenStreamsCron(): Promise<void> {
  const {reaped, failed} = await reapStaleOpenStreamsActivity();
  if (reaped > 0 || failed > 0) {
    log.info('Reaped stale open log streams', {reaped, failed});
  }
}
