import {
  activateJobListenerActivity,
  bulkSetStepStatuses,
  cancelRunnerJobsActivity,
  drainListenerEventsActivity,
  enqueueJobExecutionForRunner,
  failJobExecutionAsTimedOutActivity,
  failRunAsTimedOutActivity,
  loadRunAttemptDag,
  releaseLeaseActivity,
  resolveJobListenerActivity,
  resolveJobStatusFromJobExecutionsActivity,
  resolveLeaseExpiredJobExecutionActivity,
  setJobExecutionStatus,
  setJobStatus,
  setRunAttemptStatus,
  settleListenerJobExecutionActivity,
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
    failRunAsTimedOutActivity,
    activateJobListenerActivity,
    drainListenerEventsActivity,
    resolveJobListenerActivity,
    settleListenerJobExecutionActivity,
    resolveLeaseExpiredJobExecutionActivity,
    resolveJobStatusFromJobExecutionsActivity,
    releaseLeaseActivity,
  };
}
