import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {workflowsOutbox} from './schema/outbox.js';
export type {
  BulkUpdateStepStatusesParams,
  CancelWorkflowRunParams,
  CreateRerunWorkflowRunParams,
  CreateWorkflowRunParams,
  ListWorkflowRunsParams,
  ListWorkflowRunsResult,
  TerminalStepAttemptLogState,
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
  getFirstJobExecutionByJobId,
  getJobById,
  getJobExecutionsByJobId,
  getJobExecutionsByRunId,
  getJobsByRunId,
  getJobWorkspaceId,
  getLatestAttempt,
  getStepAttempts,
  getStepAttemptsByJobIds,
  getStepByIdForJobExecution,
  getStepsByJobExecutionId,
  getStepsByJobExecutionIdForUpdate,
  getStepsByJobExecutionIds,
  getStepsByJobId,
  getStepsByJobIds,
  getTerminalStepAttemptLogState,
  getWorkflowJobExecutionDepth,
  getWorkflowRunAggregates,
  getWorkflowRunById,
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
