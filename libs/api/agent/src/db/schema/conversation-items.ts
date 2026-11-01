import type {ConversationItemMetaDto} from '@shipfox/api-agent-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, integer, jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ConversationItem} from '#core/entities/conversation.js';
import {bytea, pgTable} from './common.js';
import {conversations} from './conversations.js';

/**
 * The append-only timeline. `body` is sealed with the workspace data key. `meta`
 * is plain, so it must hold nothing a user typed.
 */
export const conversationItems = pgTable(
  'conversation_items',
  {
    id: uuidv7PrimaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, {onDelete: 'cascade'}),
    seq: integer('seq'),
    kind: text('kind', {
      enum: [
        'user_message',
        'assistant_message',
        'tool_call',
        'tool_result',
        'run_result',
        'compaction',
        'turn_notice',
      ],
    }).notNull(),
    turnId: uuid('turn_id'),
    authorUserId: uuid('author_user_id'),
    clientMessageId: uuid('client_message_id'),
    body: bytea('body').notNull(),
    meta: jsonb('meta').$type<ConversationItemMetaDto>().notNull().default({}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_conversation_items_seq_unique').on(table.conversationId, table.seq),
    uniqueIndex('agent_conversation_items_client_message_unique')
      .on(table.conversationId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    index('agent_conversation_items_queued_idx')
      .on(table.conversationId, table.id)
      .where(sql`${table.seq} is null`),
  ],
);

export type ConversationItemDb = typeof conversationItems.$inferSelect;

export function toConversationItem(row: ConversationItemDb): ConversationItem {
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    kind: row.kind,
    turnId: row.turnId,
    authorUserId: row.authorUserId,
    clientMessageId: row.clientMessageId,
    sealedBody: row.body,
    meta: row.meta,
    createdAt: row.createdAt,
  };
}
