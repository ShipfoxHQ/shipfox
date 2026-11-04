import {sql} from 'drizzle-orm';
import {index, primaryKey, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {conversations} from './conversations.js';

/**
 * A workflow run a conversation started, which delivers its result to that conversation.
 * `workflow_run_id` is an opaque foreign id. `check_requested_at` says the run changed since the
 * last delivery check, and a check clears it only when the value is still the one it saw.
 */
export const conversationRunLinks = pgTable(
  'conversation_run_links',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, {onDelete: 'cascade'}),
    workflowRunId: uuid('workflow_run_id').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    checkRequestedAt: timestamp('check_requested_at', {withTimezone: true}),
  },
  (table) => [
    primaryKey({
      name: 'agent_conversation_run_links_pkey',
      columns: [table.conversationId, table.workflowRunId],
    }),
    index('agent_conversation_run_links_run_idx').on(table.workflowRunId),
    index('agent_conversation_run_links_check_idx')
      .on(table.checkRequestedAt)
      .where(sql`${table.checkRequestedAt} is not null`),
  ],
);
