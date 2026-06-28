import {
  bulkSetStepStatuses,
  cancelRunnerJobsActivity,
  enqueueJobForRunner,
  failJobAsTimedOutActivity,
  loadRunDag,
  releaseLeaseActivity,
  resolveLeaseExpiredJobActivity,
  setJobStatus,
  setRunStatus,
} from './orchestration-activities.js';

export function createOrchestrationActivities() {
  return {
    loadRunDag,
    setRunStatus,
    setJobStatus,
    bulkSetStepStatuses,
    cancelRunnerJobsActivity,
    enqueueJobForRunner,
    failJobAsTimedOutActivity,
    resolveLeaseExpiredJobActivity,
    releaseLeaseActivity,
  };
}
