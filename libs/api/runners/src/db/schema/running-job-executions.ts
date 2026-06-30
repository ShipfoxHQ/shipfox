import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const runningJobExecutions = pgTable(
  'running_jobs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    jobId: uuid('job_id').notNull(),
    jobExecutionId: uuid('job_execution_id').notNull().unique(),
    runId: uuid('run_id').notNull(),
    projectId: uuid('project_id').notNull(),
    runnerSessionId: uuid('runner_session_id').notNull(),
    provisionerId: uuid('provisioner_id'),
    provisionedRunnerId: text('provisioned_runner_id'),
    requiredLabels: text('required_labels').array().notNull(),
    runnerLabels: text('runner_labels').array().notNull(),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', {withTimezone: true}).notNull().defaultNow(),
    cancellationRequestedAt: timestamp('cancellation_requested_at', {withTimezone: true}),
  },
  (table) => [
    index('runners_running_jobs_last_heartbeat_at_idx').on(table.lastHeartbeatAt),
    index('runners_running_jobs_provisioned_runner_started_idx')
      .on(table.workspaceId, table.provisionerId, table.provisionedRunnerId, table.startedAt.desc())
      .where(sql`"provisioner_id" IS NOT NULL`),
    index('runners_running_jobs_job_id_idx').on(table.jobId),
    check(
      'runners_running_jobs_link_ck',
      sql`(${table.provisionerId} IS NULL) = (${table.provisionedRunnerId} IS NULL)`,
    ),
  ],
);

export type RunningJobExecutionDb = typeof runningJobExecutions.$inferSelect;
export type RunningJobExecutionInsertDb = typeof runningJobExecutions.$inferInsert;
