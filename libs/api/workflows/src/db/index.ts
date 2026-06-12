import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {workflowsOutbox} from './schema/outbox.js';
export type {
  ApplyStepResultsParams,
  BulkUpdateStepStatusesParams,
  CreateWorkflowRunParams,
  FailJobAsTimedOutParams,
  ListWorkflowRunsParams,
  ListWorkflowRunsResult,
  ReportedStepResult,
  UpdateJobStatusParams,
  UpdateWorkflowRunStatusParams,
  WorkflowRunAggregates,
  WorkflowRunFilters,
} from './workflow-runs.js';
export {
  applyStepResults,
  bulkUpdateStepStatuses,
  createWorkflowRun,
  failJobAsTimedOut,
  getJobById,
  getJobsByRunId,
  getStepAttempts,
  getStepAttemptsByJobIds,
  getStepsByJobId,
  getStepsByJobIds,
  getWorkflowRunAggregates,
  getWorkflowRunById,
  listWorkflowRuns,
  listWorkflowRunsByProject,
  StepResultsContractViolationError,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
