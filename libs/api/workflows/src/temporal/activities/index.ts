import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import type {JobExecutionLimitsPolicy} from '#core/execution-limits.js';
import {
  activateJobListenerActivity,
  bulkSetStepStatuses,
  createDrainListenerEventsActivity,
  evaluateJobActivationsActivity,
  expireQueuedJobExecutionActivity,
  failJobExecutionAsTimedOutActivity,
  failRunAsTimedOutActivity,
  loadRunAttemptConcurrencyActivity,
  loadRunAttemptDag,
  markJobExecutionRunningActivity,
  peekListenerBufferActivity,
  queueJobExecutionActivity,
  recordListenerFiringOutcomeActivity,
  resolveExecutionLimitsActivity,
  resolveJobListenerActivity,
  resolveJobStatusFromJobExecutionsActivity,
  resolveLeaseExpiredJobExecutionActivity,
  setJobExecutionStatus,
  setJobStatus,
  setRunAttemptStatus,
  settleListenerJobExecutionActivity,
} from './orchestration-activities.js';

export function createOrchestrationActivities(params: {
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
  secrets: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>;
  executionLimits?: {policy: JobExecutionLimitsPolicy} | undefined;
}) {
  return {
    loadRunAttemptConcurrencyActivity,
    loadRunAttemptDag,
    setRunAttemptStatus,
    setJobStatus,
    setJobExecutionStatus: async (activityParams: Parameters<typeof setJobExecutionStatus>[0]) =>
      await setJobExecutionStatus(activityParams, params.secrets),
    markJobExecutionRunningActivity: async (
      activityParams: Parameters<typeof markJobExecutionRunningActivity>[0],
    ) => await markJobExecutionRunningActivity(activityParams, params.secrets),
    resolveExecutionLimitsActivity: async (
      activityParams: Parameters<typeof resolveExecutionLimitsActivity>[0],
    ) => await resolveExecutionLimitsActivity(activityParams, params.executionLimits?.policy),
    bulkSetStepStatuses,
    queueJobExecutionActivity,
    expireQueuedJobExecutionActivity: async (activityParams: {jobExecutionId: string}) =>
      await expireQueuedJobExecutionActivity(activityParams, params.runners),
    evaluateJobActivationsActivity,
    failJobExecutionAsTimedOutActivity: async (
      activityParams: Parameters<typeof failJobExecutionAsTimedOutActivity>[0],
    ) => await failJobExecutionAsTimedOutActivity(activityParams, params.secrets),
    failRunAsTimedOutActivity,
    activateJobListenerActivity,
    drainListenerEventsActivity: createDrainListenerEventsActivity({
      agent: params.agent,
      integrations: params.integrations,
      projects: params.projects,
      secrets: params.secrets,
    }),
    peekListenerBufferActivity,
    resolveJobListenerActivity,
    settleListenerJobExecutionActivity,
    recordListenerFiringOutcomeActivity,
    resolveLeaseExpiredJobExecutionActivity: async (
      activityParams: Parameters<typeof resolveLeaseExpiredJobExecutionActivity>[0],
    ) => await resolveLeaseExpiredJobExecutionActivity(activityParams, params.secrets),
    resolveJobStatusFromJobExecutionsActivity,
  };
}
