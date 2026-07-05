import {continueAsNew, proxyActivities, sleep} from '@temporalio/workflow';
import type {createActivities} from '../activities/index.js';

const {drainAndDispatch} = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '60s',
});

const {pruneOutboxRetention} = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '5m',
});

export async function outboxDispatcherWorkflow(): Promise<void> {
  const hasMore = await drainAndDispatch();
  if (!hasMore) await sleep(POLL_INTERVAL);
  await continueAsNew<typeof outboxDispatcherWorkflow>();
}

export async function outboxRetentionWorkflow(): Promise<void> {
  await pruneOutboxRetention();
}

const POLL_INTERVAL = '250ms';
