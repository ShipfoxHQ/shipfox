import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {CapacityAssignment} from '#core/entities/capacity-assignment.js';
import {pgTable} from './common.js';

export const capacityAssignments = pgTable(
  'capacity_assignments',
  {
    id: uuidv7PrimaryKey(),
    capacityId: uuid('capacity_id').notNull(),
    reservationId: uuid('reservation_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_capacity_assignments_capacity_unique').on(table.capacityId),
    index('runners_capacity_assignments_reservation_idx').on(table.reservationId),
    index('runners_capacity_assignments_workspace_idx').on(table.workspaceId),
  ],
);

export type CapacityAssignmentDb = typeof capacityAssignments.$inferSelect;

export function toCapacityAssignment(row: CapacityAssignmentDb): CapacityAssignment {
  return {
    id: row.id,
    capacityId: row.capacityId,
    reservationId: row.reservationId,
    workspaceId: row.workspaceId,
    provisionerId: row.provisionerId,
    createdAt: row.createdAt,
  };
}
