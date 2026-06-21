import {pruneTriggerEventsActivity} from './prune-trigger-events.js';

export function createTriggersMaintenanceActivities() {
  return {
    pruneTriggerEventsActivity,
  };
}
