import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {WorkflowConcurrencyClaim} from '#core/entities/workflow-concurrency-claim.js';
import {pgTable} from './common.js';
import {workflowRunAttempts} from './workflow-run-attempts.js';
import {workflowRuns} from './workflow-runs.js';

export const workflowConcurrencyScopeEnum = pgEnum('workflows_concurrency_scope', [
  'workflow',
  'project',
]);

export const workflowConcurrencyClaimStateEnum = pgEnum('workflows_concurrency_claim_state', [
  'acquired',
  'waiting',
  'superseded',
  'released',
]);

export const workflowConcurrencyClaims = pgTable(
  'workflow_concurrency_claims',
  {
    id: uuidv7PrimaryKey(),
    projectId: uuid('project_id').notNull(),
    originScope: text('origin_scope').notNull(),
    scope: workflowConcurrencyScopeEnum('scope').notNull(),
    definitionId: uuid('definition_id'),
    displayGroup: text('display_group').notNull(),
    canonicalGroupKey: text('canonical_group_key').notNull(),
    workflowRunId: uuid('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, {onDelete: 'cascade'}),
    workflowRunAttemptId: uuid('workflow_run_attempt_id')
      .notNull()
      .references(() => workflowRunAttempts.id, {onDelete: 'cascade'}),
    generation: integer('generation').notNull(),
    cancelInProgress: boolean('cancel_in_progress').notNull(),
    state: workflowConcurrencyClaimStateEnum('state').notNull(),
    supersededByClaimId: uuid('superseded_by_claim_id'),
    cancellationRequestedAt: timestamp('cancellation_requested_at', {withTimezone: true}),
    stateChangedAt: timestamp('state_changed_at', {withTimezone: true}).notNull().defaultNow(),
    acquiredAt: timestamp('acquired_at', {withTimezone: true}),
    waitingAt: timestamp('waiting_at', {withTimezone: true}),
    supersededAt: timestamp('superseded_at', {withTimezone: true}),
    releasedAt: timestamp('released_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflows_wcc_workflow_run_attempt_unique').on(table.workflowRunAttemptId),
    uniqueIndex('workflows_wcc_workflow_generation_unique')
      .on(
        table.projectId,
        table.originScope,
        table.definitionId,
        table.canonicalGroupKey,
        table.generation,
      )
      .where(sql`${table.scope} = 'workflow'`),
    uniqueIndex('workflows_wcc_project_generation_unique')
      .on(table.projectId, table.originScope, table.canonicalGroupKey, table.generation)
      .where(sql`${table.scope} = 'project'`),
    uniqueIndex('workflows_wcc_workflow_acquired_unique')
      .on(table.projectId, table.originScope, table.definitionId, table.canonicalGroupKey)
      .where(sql`${table.scope} = 'workflow' and ${table.state} = 'acquired'`),
    uniqueIndex('workflows_wcc_project_acquired_unique')
      .on(table.projectId, table.originScope, table.canonicalGroupKey)
      .where(sql`${table.scope} = 'project' and ${table.state} = 'acquired'`),
    uniqueIndex('workflows_wcc_workflow_waiting_unique')
      .on(table.projectId, table.originScope, table.definitionId, table.canonicalGroupKey)
      .where(sql`${table.scope} = 'workflow' and ${table.state} = 'waiting'`),
    uniqueIndex('workflows_wcc_project_waiting_unique')
      .on(table.projectId, table.originScope, table.canonicalGroupKey)
      .where(sql`${table.scope} = 'project' and ${table.state} = 'waiting'`),
    index('workflows_wcc_project_created_id_idx').on(table.projectId, table.createdAt, table.id),
    index('workflows_wcc_workflow_run_id_idx').on(table.workflowRunId),
    check('workflows_wcc_generation_positive_ck', sql`${table.generation} > 0`),
    check(
      'workflows_wcc_display_group_bytes_ck',
      sql`octet_length(${table.displayGroup}) between 1 and 256`,
    ),
    check(
      'workflows_wcc_scope_definition_ck',
      sql`(
        (${table.scope} = 'workflow' and ${table.definitionId} is not null)
        or (${table.scope} = 'project' and ${table.definitionId} is null)
      )`,
    ),
    check('workflows_wcc_origin_scope_nonempty_ck', sql`length(${table.originScope}) > 0`),
  ],
);

export type WorkflowConcurrencyClaimDb = typeof workflowConcurrencyClaims.$inferSelect;
export type WorkflowConcurrencyClaimCreateDb = typeof workflowConcurrencyClaims.$inferInsert;

export function toWorkflowConcurrencyClaim(
  row: WorkflowConcurrencyClaimDb,
): WorkflowConcurrencyClaim {
  return {
    id: row.id,
    projectId: row.projectId,
    originScope: row.originScope,
    scope: row.scope,
    definitionId: row.definitionId,
    displayGroup: row.displayGroup,
    canonicalGroupKey: row.canonicalGroupKey,
    workflowRunId: row.workflowRunId,
    workflowRunAttemptId: row.workflowRunAttemptId,
    generation: row.generation,
    cancelInProgress: row.cancelInProgress,
    state: row.state,
    supersededByClaimId: row.supersededByClaimId,
    cancellationRequestedAt: row.cancellationRequestedAt,
    stateChangedAt: row.stateChangedAt,
    acquiredAt: row.acquiredAt,
    waitingAt: row.waitingAt,
    supersededAt: row.supersededAt,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
