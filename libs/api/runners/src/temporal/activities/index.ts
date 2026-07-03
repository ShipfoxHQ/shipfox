import {
  deleteExpiredReservationsActivity,
  deleteExpiredRunnerSessionsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleProvisionedRunnersActivity,
} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    deleteExpiredReservationsActivity,
    deleteExpiredRunnerSessionsActivity,
    detectAndExpireStuckJobsActivity,
    reapStaleProvisionedRunnersActivity,
  };
}
