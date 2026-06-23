import {continueAsNew, proxyActivities, sleep} from '@temporalio/workflow';
import type {createActivities} from '../activities/index.js';

const {drainAndDispatch} = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '30s',
});

const {pruneOutboxRetention} = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '30s',
});

export async function outboxDispatcherWorkflow(): Promise<void> {
  await drainAndDispatch();
  await sleep('1s');
  await continueAsNew<typeof outboxDispatcherWorkflow>();
}

export async function outboxRetentionWorkflow(): Promise<void> {
  await pruneOutboxRetention();
}
