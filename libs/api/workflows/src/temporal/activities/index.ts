import {
  bulkSetStepStatuses,
  cancelRunnerJobsActivity,
  enqueueJobForRunner,
  failExecutionAsTimedOutActivity,
  loadRunDag,
  releaseLeaseActivity,
  resolveJobStatusFromExecutionsActivity,
  resolveLeaseExpiredExecutionActivity,
  setExecutionStatus,
  setJobStatus,
  setRunStatus,
} from './orchestration-activities.js';

export function createOrchestrationActivities() {
  return {
    loadRunDag,
    setRunStatus,
    setJobStatus,
    setExecutionStatus,
    bulkSetStepStatuses,
    cancelRunnerJobsActivity,
    enqueueJobForRunner,
    failExecutionAsTimedOutActivity,
    resolveLeaseExpiredExecutionActivity,
    resolveJobStatusFromExecutionsActivity,
    releaseLeaseActivity,
  };
}
