import {index, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {conversations} from './conversations.js';

/**
 * A reply an integration conversation has handled, so a repeat of its delivery sends nothing.
 * `reply_id` is the turn that produced the reply, or the notice that explains a denial.
 */
export const replyDeliveries = pgTable(
  'reply_deliveries',
  {
    replyId: uuid('reply_id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, {onDelete: 'cascade'}),
    outcome: text('outcome', {enum: ['delivered', 'undeliverable', 'skipped']}).notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('agent_reply_deliveries_conversation_idx').on(table.conversationId)],
);
