import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {Conversation} from '#core/entities/conversation.js';
import {bytea, pgTable} from './common.js';

/**
 * Conversations with an agent. `workspace_id` and `project_id` are opaque foreign
 * ids. `title` is sealed with the workspace data key.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    agentKey: text('agent_key').notNull(),
    originKind: text('origin_kind', {enum: ['web', 'integration']}).notNull(),
    ownerUserId: uuid('owner_user_id'),
    clientMessageId: uuid('client_message_id'),
    title: bytea('title'),
    lastSeq: integer('last_seq').notNull().default(0),
    lastAgentSeq: integer('last_agent_seq').notNull().default(0),
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    runStartsSinceHuman: integer('run_starts_since_human').notNull().default(0),
    contextStartSeq: integer('context_start_seq').notNull().default(1),
    retryRequestedAt: timestamp('retry_requested_at', {withTimezone: true}),
    lastActivityAt: timestamp('last_activity_at', {withTimezone: true}).notNull().defaultNow(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    check(
      'agent_conversations_web_owner_ck',
      sql`(${table.originKind} = 'web' and ${table.ownerUserId} is not null) or (${table.originKind} = 'integration' and ${table.ownerUserId} is null)`,
    ),
    uniqueIndex('agent_conversations_client_message_unique')
      .on(table.projectId, table.ownerUserId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    index('agent_conversations_web_owner_activity_idx')
      .on(table.projectId, table.ownerUserId, table.lastActivityAt, table.id)
      .where(sql`${table.originKind} = 'web'`),
    index('agent_conversations_retry_requested_idx')
      .on(table.retryRequestedAt)
      .where(sql`${table.retryRequestedAt} is not null`),
  ],
);

export type ConversationDb = typeof conversations.$inferSelect;

export function toConversation(row: ConversationDb): Conversation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    agentKey: row.agentKey,
    originKind: row.originKind,
    ownerUserId: row.ownerUserId,
    clientMessageId: row.clientMessageId,
    sealedTitle: row.title,
    lastSeq: row.lastSeq,
    lastAgentSeq: row.lastAgentSeq,
    lastReadSeq: row.lastReadSeq,
    runStartsSinceHuman: row.runStartsSinceHuman,
    contextStartSeq: row.contextStartSeq,
    retryRequestedAt: row.retryRequestedAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
  };
}
