import {
  deleteExpiredReservationsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleProvisionedRunnersActivity,
} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    deleteExpiredReservationsActivity,
    detectAndExpireStuckJobsActivity,
    reapStaleProvisionedRunnersActivity,
  };
}
