import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AgentTurn} from '#core/entities/conversation.js';
import {pgTable} from './common.js';
import {conversations} from './conversations.js';

export const turns = pgTable(
  'turns',
  {
    id: uuidv7PrimaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, {onDelete: 'cascade'}),
    status: text('status', {enum: ['running', 'succeeded', 'failed', 'stopped']}).notNull(),
    failureCode: text('failure_code'),
    stopRequestedAt: timestamp('stop_requested_at', {withTimezone: true}),
    model: text('model'),
    provider: text('provider'),
    thinking: text('thinking'),
    modelCallCount: integer('model_call_count').notNull().default(0),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
  },
  (table) => [
    index('agent_turns_conversation_idx').on(table.conversationId),
    uniqueIndex('agent_turns_one_running_unique')
      .on(table.conversationId)
      .where(sql`${table.status} = 'running'`),
  ],
);

export type AgentTurnDb = typeof turns.$inferSelect;

export function toAgentTurn(row: AgentTurnDb): AgentTurn {
  return {
    id: row.id,
    conversationId: row.conversationId,
    status: row.status,
    failureCode: row.failureCode,
    stopRequestedAt: row.stopRequestedAt,
    model: row.model,
    provider: row.provider,
    thinking: row.thinking,
    modelCallCount: row.modelCallCount,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
