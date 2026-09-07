import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {desc, sql} from 'drizzle-orm';
import {check, index, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {adminRoleEnum} from './admin-grants.js';
import {pgTable} from './common.js';
import {users} from './users.js';

export const impersonationWindows = pgTable(
  'impersonation_windows',
  {
    id: uuidv7PrimaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    reason: text('reason').notNull(),
    actorRoleAtStart: adminRoleEnum('actor_role_at_start').notNull(),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull(),
    deadlineAt: timestamp('deadline_at', {withTimezone: true}).notNull(),
    endedAt: timestamp('ended_at', {withTimezone: true}),
    endedReason: text('ended_reason'),
  },
  (table) => [
    check(
      'auth_impersonation_windows_terminal_consistency_ck',
      sql`(${table.endedAt} IS NULL AND ${table.endedReason} IS NULL) OR (${table.endedAt} IS NOT NULL AND ${table.endedReason} IS NOT NULL)`,
    ),
    check(
      'auth_impersonation_windows_deadline_after_start_ck',
      sql`${table.deadlineAt} > ${table.startedAt}`,
    ),
    check(
      'auth_impersonation_windows_ended_reason_ck',
      sql`${table.endedReason} IS NULL OR ${table.endedReason} IN ('stopped', 'expired')`,
    ),
    index('auth_impersonation_windows_actor_open_started_id_idx')
      .on(table.actorId, desc(table.startedAt), desc(table.id))
      .where(sql`${table.endedAt} IS NULL`),
    index('auth_impersonation_windows_target_started_idx').on(
      table.targetUserId,
      desc(table.startedAt),
    ),
  ],
);

export type ImpersonationWindowDb = typeof impersonationWindows.$inferSelect;
export type ImpersonationWindowCreateDb = typeof impersonationWindows.$inferInsert;
