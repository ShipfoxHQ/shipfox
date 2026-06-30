import {
  bulkSetStepStatuses,
  cancelRunnerJobsActivity,
  enqueueJobExecutionForRunner,
  failJobExecutionAsTimedOutActivity,
  loadRunAttemptDag,
  loadRunDag,
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
    loadRunDag,
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
