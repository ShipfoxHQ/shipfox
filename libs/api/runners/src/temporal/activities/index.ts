import {detectAndFailStuckJobsActivity} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    detectAndFailStuckJobsActivity,
  };
}
