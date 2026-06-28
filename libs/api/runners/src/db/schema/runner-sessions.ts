import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, integer, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {RunnerSession} from '#core/entities/runner-session.js';
import {pgTable} from './common.js';

export const runnerSessionScopeEnum = pgEnum('runners_runner_session_scope', ['workspace']);
export const runnerSessionRegistrationTokenKindEnum = pgEnum(
  'runners_runner_session_registration_token_kind',
  ['manual', 'ephemeral'],
);

export const runnerSessions = pgTable(
  'runner_sessions',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    scope: runnerSessionScopeEnum('scope').notNull().default('workspace'),
    registrationTokenId: uuid('registration_token_id').notNull(),
    registrationTokenKind:
      runnerSessionRegistrationTokenKindEnum('registration_token_kind').notNull(),
    labels: text('labels').array().notNull(),
    maxClaims: integer('max_claims'),
    claimsUsed: integer('claims_used').notNull().default(0),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    check(
      'runners_runner_sessions_claims_ck',
      sql`${table.claimsUsed} >= 0 AND ((${table.registrationTokenKind} = 'manual' AND ${table.maxClaims} IS NULL) OR (${table.registrationTokenKind} = 'ephemeral' AND ${table.maxClaims} IS NOT NULL AND ${table.maxClaims} > 0 AND ${table.claimsUsed} <= ${table.maxClaims}))`,
    ),
  ],
);

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
    registrationTokenKind: row.registrationTokenKind,
    labels: row.labels,
    maxClaims: row.maxClaims,
    claimsUsed: row.claimsUsed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
