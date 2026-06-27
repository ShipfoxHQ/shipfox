import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {type TriggerDecision, triggerDecisionOutcomes} from '#core/entities/decision.js';
import {pgTable} from './common.js';
import {triggersReceivedEvents} from './received-events.js';

export const triggersDecisions = pgTable(
  'decisions',
  {
    id: uuidv7PrimaryKey(),
    receivedEventId: uuid('received_event_id')
      .notNull()
      .references(() => triggersReceivedEvents.id, {onDelete: 'cascade'}),
    subscriptionId: uuid('subscription_id').notNull(),
    subscriptionName: text('subscription_name').notNull(),
    workflowDefinitionId: uuid('workflow_definition_id').notNull(),
    projectId: uuid('project_id').notNull(),
    decision: text('decision', {enum: triggerDecisionOutcomes}).notNull(),
    runId: uuid('run_id'),
    runName: text('run_name'),
    reason: text('reason'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('triggers_decisions_event_subscription_unique').on(
      table.receivedEventId,
      table.subscriptionId,
    ),
    index('triggers_decisions_run_idx').on(table.runId),
  ],
);

export type TriggerDecisionDb = typeof triggersDecisions.$inferSelect;
export type TriggerDecisionInsertDb = typeof triggersDecisions.$inferInsert;

export function toTriggerDecision(row: TriggerDecisionDb): TriggerDecision {
  return {
    id: row.id,
    receivedEventId: row.receivedEventId,
    subscriptionId: row.subscriptionId,
    subscriptionName: row.subscriptionName,
    workflowDefinitionId: row.workflowDefinitionId,
    projectId: row.projectId,
    decision: row.decision,
    runId: row.runId,
    runName: row.runName,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}
