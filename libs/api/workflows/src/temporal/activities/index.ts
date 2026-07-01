import {
  bulkSetStepStatuses,
  cancelRunnerJobsActivity,
  enqueueJobExecutionForRunner,
  failJobExecutionAsTimedOutActivity,
  loadRunAttemptDag,
  releaseLeaseActivity,
  resolveJobStatusFromJobExecutionsActivity,
  resolveLeaseExpiredJobExecutionActivity,
  setJobExecutionStatus,
  setJobStatus,
  setRunAttemptStatus,
} from './orchestration-activities.js';

export function createOrchestrationActivities() {
  return {
    loadRunAttemptDag,
    setRunAttemptStatus,
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
