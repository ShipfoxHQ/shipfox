import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, integer, jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ConversationItem, ConversationItemMeta} from '#core/entities/conversation.js';
import {bytea, pgTable} from './common.js';
import {conversations} from './conversations.js';

/**
 * The append-only timeline, one pi session entry per row. `body` is the entry,
 * gzipped and sealed with the workspace data key. Its `id` and `parentId` stay
 * out: the row ID is the entry ID, and `seq` gives the parent. `meta` is plain,
 * so it must hold nothing a user typed.
 */
export const conversationItems = pgTable(
  'conversation_items',
  {
    id: uuidv7PrimaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, {onDelete: 'cascade'}),
    seq: integer('seq'),
    entryType: text('entry_type').notNull(),
    sessionVersion: integer('session_version').notNull(),
    turnId: uuid('turn_id'),
    modelCallIndex: integer('model_call_index'),
    callIndex: integer('call_index'),
    authorUserId: uuid('author_user_id'),
    clientMessageId: uuid('client_message_id'),
    body: bytea('body').notNull(),
    meta: jsonb('meta').$type<ConversationItemMeta>().notNull().default({}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_conversation_items_seq_unique').on(table.conversationId, table.seq),
    uniqueIndex('agent_conversation_items_client_message_unique')
      .on(table.conversationId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    uniqueIndex('agent_conversation_items_model_call_unique')
      .on(table.turnId, table.modelCallIndex)
      .where(sql`${table.modelCallIndex} is not null and ${table.callIndex} is null`),
    uniqueIndex('agent_conversation_items_tool_call_unique')
      .on(table.turnId, table.modelCallIndex, table.callIndex)
      .where(sql`${table.callIndex} is not null`),
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
    entryType: row.entryType,
    sessionVersion: row.sessionVersion,
    turnId: row.turnId,
    modelCallIndex: row.modelCallIndex,
    callIndex: row.callIndex,
    authorUserId: row.authorUserId,
    clientMessageId: row.clientMessageId,
    sealedEntry: row.body,
    meta: row.meta,
    createdAt: row.createdAt,
  };
}
