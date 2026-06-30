import {
  bulkSetStepStatuses,
  cancelRunnerJobsActivity,
  enqueueJobExecutionForRunner,
  failJobExecutionAsTimedOutActivity,
  loadRunDag,
  releaseLeaseActivity,
  resolveJobStatusFromJobExecutionsActivity,
  resolveLeaseExpiredJobExecutionActivity,
  setJobExecutionStatus,
  setJobStatus,
  setRunStatus,
} from './orchestration-activities.js';

export function createOrchestrationActivities() {
  return {
    loadRunDag,
    setRunStatus,
    setJobStatus,
    setJobExecutionStatus,
    bulkSetStepStatuses,
    cancelRunnerJobsActivity,
    enqueueJobExecutionForRunner,
    failJobExecutionAsTimedOutActivity,
    resolveLeaseExpiredJobExecutionActivity,
    resolveJobStatusFromJobExecutionsActivity,
    releaseLeaseActivity,
  };
}
