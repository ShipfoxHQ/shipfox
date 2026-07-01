import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  TriggerPayload,
  WorkflowRun,
  WorkflowSourceSnapshot,
} from '#core/entities/workflow-run.js';
import {pgTable} from './common.js';

export const workflowRunStatusEnum = pgEnum('workflows_run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const workflowRunRerunModeEnum = pgEnum('workflows_rerun_mode', ['all', 'failed']);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    definitionId: uuid('definition_id').notNull(),
    name: text('name').notNull(),
    status: workflowRunStatusEnum('status').notNull().default('pending'),
    currentAttempt: integer('current_attempt').notNull().default(1),
    triggerSource: text('trigger_source').notNull(),
    triggerEvent: text('trigger_event').notNull(),
    triggerPayload: jsonb('trigger_payload').notNull().$type<TriggerPayload>(),
    inputs: jsonb('inputs').$type<Record<string, unknown>>(),
    sourceSnapshot: jsonb('source_snapshot').$type<WorkflowSourceSnapshot>(),
    triggerIdempotencyKey: text('trigger_idempotency_key'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
  },
  (table) => [
    uniqueIndex('workflows_wr_trigger_idempotency_key_unique').on(table.triggerIdempotencyKey),
    index('workflows_wr_project_created_id_idx').on(table.projectId, table.createdAt, table.id),
    index('workflows_wr_project_status_created_id_idx').on(
      table.projectId,
      table.status,
      table.createdAt,
      table.id,
    ),
    index('workflows_wr_project_definition_created_id_idx').on(
      table.projectId,
      table.definitionId,
      table.createdAt,
      table.id,
    ),
    index('workflows_wr_project_trigger_created_id_idx').on(
      table.projectId,
      table.triggerSource,
      table.createdAt,
      table.id,
    ),
    check('workflows_wr_current_attempt_positive_ck', sql`${table.currentAttempt} > 0`),
  ],
);

export type WorkflowRunDb = typeof workflowRuns.$inferSelect;
export type WorkflowRunCreateDb = typeof workflowRuns.$inferInsert;

export function toWorkflowRun(row: WorkflowRunDb): WorkflowRun {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    definitionId: row.definitionId,
    name: row.name,
    status: row.status,
    currentAttempt: row.currentAttempt,
    triggerSource: row.triggerSource,
    triggerEvent: row.triggerEvent,
    triggerPayload: row.triggerPayload as TriggerPayload,
    inputs: row.inputs ?? null,
    sourceSnapshot: row.sourceSnapshot ?? null,
    triggerIdempotencyKey: row.triggerIdempotencyKey,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
