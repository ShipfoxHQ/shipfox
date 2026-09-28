import type {InstallationPlacementPolicy} from '#installation-provisioning.js';
import {
  deleteExpiredEphemeralRegistrationTokensActivity,
  deleteExpiredJobExecutionTombstonesActivity,
  deleteExpiredReservationsActivity,
  deleteExpiredRunnerSessionsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleRunnerInstancesActivity,
  reconcileCapacityHoldsActivity,
  recoverStaleIdleRunnerSessionsActivity,
} from './maintenance-activities.js';
export function createRunnersMaintenanceActivities(placement?: InstallationPlacementPolicy) {
  return {
    deleteExpiredEphemeralRegistrationTokensActivity,
    deleteExpiredJobExecutionTombstonesActivity,
    deleteExpiredReservationsActivity,
    deleteExpiredRunnerSessionsActivity,
    detectAndExpireStuckJobsActivity,
    reapStaleRunnerInstancesActivity,
    recoverStaleIdleRunnerSessionsActivity,
    reconcileCapacityHoldsActivity: () =>
      reconcileCapacityHoldsActivity(placement ? {placement} : {}),
  };
}
