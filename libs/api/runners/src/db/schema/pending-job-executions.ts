import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const pendingJobExecutions = pgTable(
  'pending_jobs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    workflowRunId: uuid('workflow_run_id').notNull(),
    workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
    jobId: uuid('job_id').notNull(),
    jobExecutionId: uuid('job_execution_id').notNull().unique(),
    projectId: uuid('project_id').notNull(),
    requiredLabels: text('required_labels').array().notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('runners_pending_jobs_created_idx').on(table.createdAt),
    index('runners_pending_jobs_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('runners_pending_jobs_job_id_idx').on(table.jobId),
  ],
);

export type PendingJobExecutionDb = typeof pendingJobExecutions.$inferSelect;
export type PendingJobExecutionInsertDb = typeof pendingJobExecutions.$inferInsert;
