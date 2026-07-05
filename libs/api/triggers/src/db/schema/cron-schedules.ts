import {index, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {CronSchedule} from '#core/entities/cron-schedule.js';
import {pgTable} from './common.js';
import {triggerSubscriptions} from './subscriptions.js';

export const triggersCronSchedules = pgTable(
  'cron_schedules',
  {
    subscriptionId: uuid('subscription_id')
      .primaryKey()
      .references(() => triggerSubscriptions.id, {onDelete: 'cascade'}),
    workspaceId: uuid('workspace_id').notNull(),
    cronExpression: text('cron_expression').notNull(),
    timezone: text('timezone').notNull(),
    nextFireAt: timestamp('next_fire_at', {withTimezone: true}).notNull(),
    lastFiredAt: timestamp('last_fired_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('triggers_cron_schedules_next_fire_at_idx').on(table.nextFireAt)],
);

export type CronScheduleDb = typeof triggersCronSchedules.$inferSelect;
export type CronScheduleInsertDb = typeof triggersCronSchedules.$inferInsert;

export function toCronSchedule(row: CronScheduleDb): CronSchedule {
  return {
    subscriptionId: row.subscriptionId,
    workspaceId: row.workspaceId,
    cronExpression: row.cronExpression,
    timezone: row.timezone,
    nextFireAt: row.nextFireAt,
    lastFiredAt: row.lastFiredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
