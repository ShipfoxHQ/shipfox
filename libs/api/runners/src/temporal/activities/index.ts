import {detectAndExpireStuckJobsActivity} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    detectAndExpireStuckJobsActivity,
  };
}
