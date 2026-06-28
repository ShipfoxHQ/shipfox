import {
  deleteExpiredReservationsActivity,
  detectAndExpireStuckJobsActivity,
} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    deleteExpiredReservationsActivity,
    detectAndExpireStuckJobsActivity,
  };
}
