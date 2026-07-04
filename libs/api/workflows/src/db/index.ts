import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {
  type DeliverEventToListenerParams,
  type DeliverEventToListenerResult,
  deliverEventToListener,
} from './job-listener-events.js';
export type {
  ActivateJobListenerParams,
  ActivateJobListenerResult,
  DrainListenerEventsParams,
  DrainListenerEventsResult,
  ListenerBufferPeek,
} from './job-listeners.js';
export {
  activateJobListener,
  countActiveListeners,
  drainListenerEventsIntoExecution,
  peekListenerBuffer,
  resolveJobListener,
  settleListenerJobExecution,
} from './job-listeners.js';
export {workflowsOutbox} from './schema/outbox.js';
export type {
  BulkUpdateStepStatusesParams,
  CancelWorkflowRunParams,
  CreateRerunWorkflowRunParams,
  CreateWorkflowRunParams,
  FailWorkflowRunAsTimedOutParams,
  ListWorkflowRunsParams,
  ListWorkflowRunsResult,
  UpdateJobExecutionStatusParams,
  UpdateJobStatusParams,
  UpdateWorkflowRunStatusParams,
  WorkflowJobExecutionDepth,
  WorkflowJobExecutionDepthParams,
  WorkflowRunAggregates,
  WorkflowRunFilters,
} from './workflow-runs.js';
export {
  bulkUpdateStepStatuses,
  cancelWorkflowRun,
  createRerunWorkflowRun,
  createWorkflowRun,
  failJobExecutionAsTimedOut,
  failWorkflowRunAsTimedOut,
  getFirstJobExecutionByJobId,
  getJobById,
  getJobExecutionById,
  getJobExecutionDetail,
  getJobExecutionsByJobId,
  getJobExecutionsByWorkflowRunAttemptId,
  getJobsByWorkflowRunAttemptId,
  getJobsByWorkflowRunId,
  getJobWorkspaceId,
  getLatestAttempt,
  getStepAttempts,
  getStepAttemptsByJobIds,
  getStepByIdForJobExecution,
  getStepsByJobExecutionId,
  getStepsByJobExecutionIdForUpdate,
  getWorkflowJobExecutionDepth,
  getWorkflowRunAggregates,
  getWorkflowRunAttemptById,
  getWorkflowRunByAttemptId,
  getWorkflowRunById,
  getWorkflowRunDetail,
  listRunAttempts,
  listWorkflowRuns,
  listWorkflowRunsByProject,
  recordJobExecutionQueuedAt,
  recordJobExecutionStartedAt,
  resolveJobExecutionAfterLeaseExpiry,
  resolveJobStatusFromJobExecutions,
  updateJobExecutionStatus,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
