import {pruneUnclaimedSentryInstallationsActivity} from './prune-unclaimed-installations.js';

export function createSentryMaintenanceActivities() {
  return {
    pruneUnclaimedSentryInstallationsActivity,
  };
}
