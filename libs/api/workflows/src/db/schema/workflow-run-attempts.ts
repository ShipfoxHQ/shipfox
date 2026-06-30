import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, integer, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {WorkflowRunAttempt} from '#core/entities/workflow-run-attempt.js';
import {pgTable} from './common.js';
import {workflowRunRerunModeEnum, workflowRunStatusEnum, workflowRuns} from './workflow-runs.js';

export const workflowRunAttempts = pgTable(
  'workflow_run_attempts',
  {
    id: uuidv7PrimaryKey(),
    workflowRunId: uuid('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, {onDelete: 'cascade'}),
    attempt: integer('attempt').notNull(),
    status: workflowRunStatusEnum('status').notNull().default('pending'),
    rerunMode: workflowRunRerunModeEnum('rerun_mode'),
    rerunByUserId: uuid('rerun_by_user_id'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
  },
  (table) => [
    uniqueIndex('workflows_wra_workflow_run_attempt_unique').on(table.workflowRunId, table.attempt),
    index('workflows_wra_workflow_run_id_idx').on(table.workflowRunId),
    uniqueIndex('workflows_wra_one_active_attempt_unique')
      .on(table.workflowRunId)
      .where(sql`${table.status} in ('pending', 'running')`),
  ],
);

export type WorkflowRunAttemptDb = typeof workflowRunAttempts.$inferSelect;
export type WorkflowRunAttemptCreateDb = typeof workflowRunAttempts.$inferInsert;

export function toWorkflowRunAttempt(row: WorkflowRunAttemptDb): WorkflowRunAttempt {
  return {
    id: row.id,
    workflowRunId: row.workflowRunId,
    attempt: row.attempt,
    status: row.status,
    rerunMode: row.rerunMode ?? null,
    rerunByUserId: row.rerunByUserId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
