import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  activateJobListenerActivity,
  bulkSetStepStatuses,
  createCancelRunnerJobsActivity,
  createEnqueueJobExecutionForRunner,
  createReleaseLeaseActivity,
  drainListenerEventsActivity,
  evaluateJobActivationsActivity,
  failJobExecutionAsTimedOutActivity,
  failRunAsTimedOutActivity,
  loadRunAttemptDag,
  peekListenerBufferActivity,
  recordListenerFiringOutcomeActivity,
  resolveJobListenerActivity,
  resolveJobStatusFromJobExecutionsActivity,
  resolveLeaseExpiredJobExecutionActivity,
  setJobExecutionStatus,
  setJobStatus,
  setRunAttemptStatus,
  settleListenerJobExecutionActivity,
} from './orchestration-activities.js';

export function createOrchestrationActivities(
  runners: RunnersInterModuleClient,
  secrets: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>,
) {
  return {
    loadRunAttemptDag,
    setRunAttemptStatus,
    setJobStatus,
    setJobExecutionStatus: async (params: Parameters<typeof setJobExecutionStatus>[0]) =>
      await setJobExecutionStatus(params, secrets),
    bulkSetStepStatuses,
    cancelRunnerJobsActivity: createCancelRunnerJobsActivity(runners),
    enqueueJobExecutionForRunner: createEnqueueJobExecutionForRunner(runners),
    evaluateJobActivationsActivity,
    failJobExecutionAsTimedOutActivity: async (
      params: Parameters<typeof failJobExecutionAsTimedOutActivity>[0],
    ) => await failJobExecutionAsTimedOutActivity(params, secrets),
    failRunAsTimedOutActivity,
    activateJobListenerActivity,
    drainListenerEventsActivity,
    peekListenerBufferActivity,
    resolveJobListenerActivity,
    settleListenerJobExecutionActivity,
    recordListenerFiringOutcomeActivity,
    resolveLeaseExpiredJobExecutionActivity: async (
      params: Parameters<typeof resolveLeaseExpiredJobExecutionActivity>[0],
    ) => await resolveLeaseExpiredJobExecutionActivity(params, secrets),
    resolveJobStatusFromJobExecutionsActivity,
    releaseLeaseActivity: createReleaseLeaseActivity(runners),
  };
}
