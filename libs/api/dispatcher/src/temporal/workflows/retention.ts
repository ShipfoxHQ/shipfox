import {proxyActivities} from '@temporalio/workflow';
import type {createActivities} from '../activities/index.js';

const {pruneOutboxRetention} = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: '5m',
});

export async function outboxRetentionWorkflow(): Promise<void> {
  await pruneOutboxRetention();
}
