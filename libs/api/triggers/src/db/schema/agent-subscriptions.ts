import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AgentSubscription} from '#core/entities/agent-subscription.js';
import {pgTable} from './common.js';

export const agentSubscriptions = pgTable(
  'agent_subscriptions',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    agentKey: text('agent_key').notNull(),
    source: text('source').notNull(),
    // NULL claims every request from the source.
    filter: text('filter'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('triggers_agent_subscriptions_rule_unique').on(
      table.projectId,
      table.agentKey,
      table.source,
      sql`coalesce(${table.filter}, '')`,
    ),
    index('triggers_agent_subscriptions_match_idx').on(table.workspaceId, table.source),
  ],
);

export type AgentSubscriptionDb = typeof agentSubscriptions.$inferSelect;

export function toAgentSubscription(row: AgentSubscriptionDb): AgentSubscription {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    agentKey: row.agentKey,
    source: row.source,
    filter: row.filter,
    createdAt: row.createdAt,
  };
}
