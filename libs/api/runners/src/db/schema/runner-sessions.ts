import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {RunnerSession} from '#core/entities/runner-session.js';
import {pgTable} from './common.js';

export const runnerSessions = pgTable('runner_sessions', {
  id: uuidv7PrimaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  scope: text('scope').notNull().default('workspace'),
  registrationTokenId: uuid('registration_token_id').notNull(),
  labels: text('labels').array().notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export type RunnerSessionDb = typeof runnerSessions.$inferSelect;
export type RunnerSessionInsertDb = typeof runnerSessions.$inferInsert;

export function toRunnerSession(row: RunnerSessionDb): RunnerSession {
  if (row.scope !== 'workspace') {
    throw new Error(`Unexpected runner session scope: ${row.scope}`);
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scope: row.scope,
    registrationTokenId: row.registrationTokenId,
    labels: row.labels,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
