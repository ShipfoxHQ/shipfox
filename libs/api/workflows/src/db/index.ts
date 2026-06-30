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
  UpdateExecutionStatusParams,
  UpdateJobStatusParams,
  UpdateWorkflowRunStatusParams,
  WorkflowExecutionDepth,
  WorkflowExecutionDepthParams,
  WorkflowRunAggregates,
  WorkflowRunFilters,
} from './workflow-runs.js';
export {
  bulkUpdateStepStatuses,
  cancelWorkflowRun,
  createRerunWorkflowRun,
  createWorkflowRun,
  failExecutionAsTimedOut,
  getExecutionsByJobId,
  getExecutionsByRunId,
  getFirstExecutionByJobId,
  getJobById,
  getJobsByRunId,
  getJobWorkspaceId,
  getLatestAttempt,
  getStepAttempts,
  getStepAttemptsByJobIds,
  getStepByIdForExecution,
  getStepsByExecutionId,
  getStepsByExecutionIdForUpdate,
  getStepsByExecutionIds,
  getStepsByJobId,
  getStepsByJobIds,
  getTerminalStepAttemptLogState,
  getWorkflowExecutionDepth,
  getWorkflowRunAggregates,
  getWorkflowRunById,
  listRunAttempts,
  listWorkflowRuns,
  listWorkflowRunsByProject,
  recordExecutionQueuedAt,
  recordExecutionStartedAt,
  resolveExecutionAfterLeaseExpiry,
  resolveJobStatusFromExecutions,
  updateExecutionStatus,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
