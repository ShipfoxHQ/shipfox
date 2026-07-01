import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {pgTableCreator, text, uuid} from 'drizzle-orm/pg-core';

const pgTable = pgTableCreator((name) => `runners_${name}`);

export const runningJobExecutions = pgTable('running_jobs', {
  id: uuidv7PrimaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  workflowRunId: uuid('workflow_run_id').notNull(),
  workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
  jobId: uuid('job_id').notNull(),
  jobExecutionId: uuid('job_execution_id').notNull(),
  projectId: uuid('project_id').notNull(),
  runnerSessionId: uuid('runner_session_id').notNull(),
  requiredLabels: text('required_labels').array().notNull(),
  runnerLabels: text('runner_labels').array().notNull(),
});
