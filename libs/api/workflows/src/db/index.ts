import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {workflowsOutbox} from './schema/outbox.js';
export type {
  BulkUpdateStepStatusesParams,
  CreateWorkflowRunParams,
  FailJobAsTimedOutParams,
  ListWorkflowRunsParams,
  ListWorkflowRunsResult,
  UpdateJobStatusParams,
  UpdateWorkflowRunStatusParams,
  WorkflowExecutionDepth,
  WorkflowRunAggregates,
  WorkflowRunFilters,
} from './workflow-runs.js';
export {
  bulkUpdateStepStatuses,
  createWorkflowRun,
  failJobAsTimedOut,
  getJobById,
  getJobsByRunId,
  getStepAttempts,
  getStepAttemptsByJobIds,
  getStepsByJobId,
  getStepsByJobIdForUpdate,
  getStepsByJobIds,
  getWorkflowExecutionDepth,
  getWorkflowRunAggregates,
  getWorkflowRunById,
  listWorkflowRuns,
  listWorkflowRunsByProject,
  recordJobQueuedAt,
  recordJobStartedAt,
  resolveJobAfterLeaseExpiry,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
