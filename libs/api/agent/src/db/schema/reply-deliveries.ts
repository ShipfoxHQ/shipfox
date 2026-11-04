import {index, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {conversations} from './conversations.js';

/**
 * A reply an integration conversation has handled, so a repeat of its delivery sends nothing.
 * `reply_id` is the turn that produced the reply, or the notice that explains a denial.
 * `suppressed` marks a turn stopped because its project was deleted, which posts nothing back.
 */
export const replyDeliveries = pgTable(
  'reply_deliveries',
  {
    replyId: uuid('reply_id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, {onDelete: 'cascade'}),
    outcome: text('outcome', {
      enum: ['delivered', 'undeliverable', 'skipped', 'suppressed'],
    }).notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('agent_reply_deliveries_conversation_idx').on(table.conversationId)],
);
