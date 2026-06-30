import {
  bulkSetStepStatuses,
  cancelRunnerJobsActivity,
  enqueueJobForRunner,
  failExecutionAsTimedOutActivity,
  failJobAsTimedOutActivity,
  loadRunDag,
  releaseLeaseActivity,
  resolveJobStatusFromExecutionsActivity,
  resolveLeaseExpiredExecutionActivity,
  resolveLeaseExpiredJobActivity,
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
    failJobAsTimedOutActivity,
    resolveLeaseExpiredExecutionActivity,
    resolveLeaseExpiredJobActivity,
    resolveJobStatusFromExecutionsActivity,
    releaseLeaseActivity,
  };
}
