import {
  deleteExpiredEphemeralRegistrationTokensActivity,
  deleteExpiredReservationsActivity,
  deleteExpiredRunnerSessionsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleRunnerInstancesActivity,
} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    deleteExpiredEphemeralRegistrationTokensActivity,
    deleteExpiredReservationsActivity,
    deleteExpiredRunnerSessionsActivity,
    detectAndExpireStuckJobsActivity,
    reapStaleRunnerInstancesActivity,
  };
}
