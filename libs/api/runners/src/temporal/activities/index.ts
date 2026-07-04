import {
  deleteExpiredEphemeralRegistrationTokensActivity,
  deleteExpiredReservationsActivity,
  deleteExpiredRunnerSessionsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleProvisionedRunnersActivity,
} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    deleteExpiredEphemeralRegistrationTokensActivity,
    deleteExpiredReservationsActivity,
    deleteExpiredRunnerSessionsActivity,
    detectAndExpireStuckJobsActivity,
    reapStaleProvisionedRunnersActivity,
  };
}
