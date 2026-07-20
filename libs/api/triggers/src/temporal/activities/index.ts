import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {drainCronBatchActivity, readCronFanoutActivity} from './drain-cron-batch.js';
import {pruneTriggerEventsActivity} from './prune-trigger-events.js';

export function createTriggersMaintenanceActivities() {
  return {
    pruneTriggerEventsActivity,
  };
}

export function createTriggersCronActivities(workflows: WorkflowsModuleClient) {
  return {
    drainCronBatchActivity: () => drainCronBatchActivity(workflows),
    readCronFanoutActivity,
  };
}
