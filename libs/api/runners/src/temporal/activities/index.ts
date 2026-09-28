import {
  deleteExpiredEphemeralRegistrationTokensActivity,
  deleteExpiredJobExecutionTombstonesActivity,
  deleteExpiredReservationsActivity,
  deleteExpiredRunnerSessionsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleRunnerInstancesActivity,
  recoverStaleIdleRunnerSessionsActivity,
} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    deleteExpiredEphemeralRegistrationTokensActivity,
    deleteExpiredJobExecutionTombstonesActivity,
    deleteExpiredReservationsActivity,
    deleteExpiredRunnerSessionsActivity,
    detectAndExpireStuckJobsActivity,
    reapStaleRunnerInstancesActivity,
    recoverStaleIdleRunnerSessionsActivity,
  };
}
