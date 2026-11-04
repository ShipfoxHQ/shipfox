import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {Conversation} from '#core/entities/conversation.js';
import {bytea, pgTable} from './common.js';

/**
 * Conversations with an agent. `workspace_id` and `project_id` are opaque foreign
 * ids. `title` is sealed with the workspace data key. An integration conversation
 * names its connection, provider, and the provider's key, and one agent owns each key.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    agentKey: text('agent_key').notNull(),
    // The content hash of the agent file the pinned prompt came from. Null for the built-in agent alone.
    agentContentHash: text('agent_content_hash'),
    originKind: text('origin_kind', {enum: ['web', 'integration']}).notNull(),
    ownerUserId: uuid('owner_user_id'),
    originConnectionId: uuid('origin_connection_id'),
    originProvider: text('origin_provider'),
    originKey: text('origin_key'),
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
    check(
      'agent_conversations_integration_origin_ck',
      sql`(${table.originKind} = 'integration' and ${table.originConnectionId} is not null and ${table.originProvider} is not null and ${table.originKey} is not null) or (${table.originKind} = 'web' and ${table.originConnectionId} is null and ${table.originProvider} is null and ${table.originKey} is null)`,
    ),
    uniqueIndex('agent_conversations_origin_key_unique').on(
      table.originConnectionId,
      table.originKey,
    ),
    uniqueIndex('agent_conversations_client_message_unique')
      .on(table.projectId, table.ownerUserId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    index('agent_conversations_web_owner_activity_idx')
      .on(table.projectId, table.ownerUserId, table.lastActivityAt, table.id)
      .where(sql`${table.originKind} = 'web'`),
    index('agent_conversations_project_idx').on(table.projectId),
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
    agentContentHash: row.agentContentHash,
    originKind: row.originKind,
    ownerUserId: row.ownerUserId,
    originConnectionId: row.originConnectionId,
    originProvider: row.originProvider,
    originKey: row.originKey,
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
