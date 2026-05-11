import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, jsonb, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {TriggerContext, TriggerSource, WorkflowRun} from '#core/entities/workflow-run.js';
import {pgTable} from './common.js';

export const workflowRunStatusEnum = pgEnum('workflows_run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const workflowRunTriggerSourceEnum = pgEnum('workflows_run_trigger_source', [
  'manual',
  'webhook',
  'schedule',
]);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    definitionId: uuid('definition_id').notNull(),
    name: text('name').notNull(),
    status: workflowRunStatusEnum('status').notNull().default('pending'),
    triggerSource: workflowRunTriggerSourceEnum('trigger_source').notNull(),
    triggerContext: jsonb('trigger_context').notNull().$type<TriggerContext>(),
    inputs: jsonb('inputs').$type<Record<string, unknown>>(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
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
    triggerSource: row.triggerSource as TriggerSource,
    triggerContext: row.triggerContext as TriggerContext,
    inputs: row.inputs ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
