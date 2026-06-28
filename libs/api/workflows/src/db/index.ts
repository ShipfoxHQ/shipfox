import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {workflowsOutbox} from './schema/outbox.js';
export type {
  BulkUpdateStepStatusesParams,
  CancelWorkflowRunParams,
  CreateRerunWorkflowRunParams,
  CreateWorkflowRunParams,
  FailJobAsTimedOutParams,
  ListWorkflowRunsParams,
  ListWorkflowRunsResult,
  TerminalStepAttemptLogState,
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
  failJobAsTimedOut,
  getJobById,
  getJobsByRunId,
  getLatestAttempt,
  getStepAttempts,
  getStepAttemptsByJobIds,
  getStepsByJobId,
  getStepsByJobIdForUpdate,
  getStepsByJobIds,
  getTerminalStepAttemptLogState,
  getWorkflowExecutionDepth,
  getWorkflowRunAggregates,
  getWorkflowRunById,
  listRunAttempts,
  listWorkflowRuns,
  listWorkflowRunsByProject,
  recordJobQueuedAt,
  recordJobStartedAt,
  resolveJobAfterLeaseExpiry,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
