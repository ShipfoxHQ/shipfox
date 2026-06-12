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
  WorkflowRunAggregates,
  WorkflowRunFilters,
} from './workflow-runs.js';
export {
  bulkUpdateStepStatuses,
  createWorkflowRun,
  failJobAsTimedOut,
  getJobsByRunId,
  getStepAttempts,
  getStepAttemptsByJobIds,
  getStepsByJobId,
  getStepsByJobIdForUpdate,
  getStepsByJobIds,
  getWorkflowRunAggregates,
  getWorkflowRunById,
  listWorkflowRuns,
  listWorkflowRunsByProject,
  resolveJobAfterLeaseExpiry,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
