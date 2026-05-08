import {
  applyStepResultsActivity,
  bulkSetStepStatuses,
  enqueueJobForRunner,
  failJobAsTimedOutActivity,
  loadRunDag,
  setJobStatus,
  setRunStatus,
} from './orchestration-activities.js';

export function createOrchestrationActivities() {
  return {
    loadRunDag,
    setRunStatus,
    setJobStatus,
    bulkSetStepStatuses,
    applyStepResultsActivity,
    enqueueJobForRunner,
    failJobAsTimedOutActivity,
  };
}
