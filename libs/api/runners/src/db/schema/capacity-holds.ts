import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const capacityHolds = pgTable(
  'capacity_holds',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    units: integer('units').notNull(),
    reservationId: uuid('reservation_id'),
    runnerInstanceId: uuid('runner_instance_id'),
    jobExecutionId: uuid('job_execution_id'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    releasedAt: timestamp('released_at', {withTimezone: true}),
    releaseReason: text('release_reason'),
  },
  (table) => [
    index('runners_capacity_holds_workspace_active_idx')
      .on(table.workspaceId)
      .where(sql`released_at is null`),
    uniqueIndex('runners_capacity_holds_runner_active_unique')
      .on(table.runnerInstanceId)
      .where(sql`runner_instance_id is not null and released_at is null`),
    check('runners_capacity_holds_units_positive_ck', sql`${table.units} > 0`),
  ],
);

export type CapacityHoldDb = typeof capacityHolds.$inferSelect;
export type CapacityHoldInsertDb = typeof capacityHolds.$inferInsert;
