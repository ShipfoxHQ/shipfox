import {drainCronBatchActivity, readCronFanoutActivity} from './drain-cron-batch.js';
import {pruneTriggerEventsActivity} from './prune-trigger-events.js';

export function createTriggersMaintenanceActivities() {
  return {
    pruneTriggerEventsActivity,
  };
}

export function createTriggersCronActivities() {
  return {
    drainCronBatchActivity,
    readCronFanoutActivity,
  };
}
