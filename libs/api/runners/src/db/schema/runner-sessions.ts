import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, integer, jsonb, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
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
    provisionerId: uuid('provisioner_id'),
    provisionedRunnerId: text('provisioned_runner_id'),
    labels: text('labels').array().notNull(),
    toolCapabilities: jsonb('tool_capabilities').$type<RunnerToolCapabilitiesDto | null>(),
    toolCapabilitiesReportedAt: timestamp('tool_capabilities_reported_at', {withTimezone: true}),
    maxClaims: integer('max_claims'),
    claimsUsed: integer('claims_used').notNull().default(0),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('runners_runner_sessions_kind_created_id_idx').on(
      table.registrationTokenKind,
      table.createdAt,
      table.id,
    ),
    check(
      'runners_runner_sessions_claims_ck',
      sql`${table.claimsUsed} >= 0 AND ((${table.registrationTokenKind} = 'manual' AND ${table.maxClaims} IS NULL) OR (${table.registrationTokenKind} = 'ephemeral' AND ${table.maxClaims} IS NOT NULL AND ${table.maxClaims} > 0 AND ${table.claimsUsed} <= ${table.maxClaims}))`,
    ),
    check(
      'runners_runner_sessions_link_ck',
      sql`((${table.registrationTokenKind} = 'manual' AND ${table.provisionerId} IS NULL AND ${table.provisionedRunnerId} IS NULL) OR (${table.registrationTokenKind} = 'ephemeral' AND ${table.provisionerId} IS NOT NULL AND ${table.provisionedRunnerId} IS NOT NULL))`,
    ),
    index('runners_runner_sessions_provisioned_runner_updated_idx')
      .on(table.workspaceId, table.provisionerId, table.provisionedRunnerId, table.updatedAt)
      .where(sql`"provisioner_id" IS NOT NULL`),
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
    provisionerId: row.provisionerId,
    provisionedRunnerId: row.provisionedRunnerId,
    labels: row.labels,
    toolCapabilities: row.toolCapabilities,
    toolCapabilitiesReportedAt: row.toolCapabilitiesReportedAt,
    maxClaims: row.maxClaims,
    claimsUsed: row.claimsUsed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
