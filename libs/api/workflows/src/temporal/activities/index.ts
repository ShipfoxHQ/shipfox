import {
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
    enqueueJobForRunner,
    failJobAsTimedOutActivity,
  };
}
