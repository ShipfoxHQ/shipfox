import {bigint, integer, text, timestamp} from 'drizzle-orm/pg-core';
import type {DiscordGatewaySession} from '#db/gateway-sessions.js';
import {pgTable} from './common.js';

export const discordGatewaySessions = pgTable('gateway_sessions', {
  shardId: integer('shard_id').primaryKey(),
  sessionId: text('session_id'),
  resumeGatewayUrl: text('resume_gateway_url'),
  receivedSequence: bigint('received_sequence', {mode: 'number'}),
  committedSequence: bigint('committed_sequence', {mode: 'number'}),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export type DiscordGatewaySessionDb = typeof discordGatewaySessions.$inferSelect;

export function toDiscordGatewaySession(row: DiscordGatewaySessionDb): DiscordGatewaySession {
  return {
    shardId: row.shardId,
    sessionId: row.sessionId,
    resumeGatewayUrl: row.resumeGatewayUrl,
    receivedSequence: row.receivedSequence,
    committedSequence: row.committedSequence,
    updatedAt: row.updatedAt,
  };
}
