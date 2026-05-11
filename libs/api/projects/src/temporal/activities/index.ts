import {pruneIntegrationEventDedupActivity} from './prune-integration-event-dedup.js';

export function createProjectsMaintenanceActivities() {
  return {
    pruneIntegrationEventDedupActivity,
  };
}
