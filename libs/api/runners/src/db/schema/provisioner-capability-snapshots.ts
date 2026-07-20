import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {ProvisionerCapabilitySnapshot} from '#core/entities/provisioner-capability-snapshot.js';
import {pgTable} from './common.js';

export const provisionerCapabilitySnapshots = pgTable(
  'provisioner_capability_snapshots',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    templateKey: text('template_key').notNull(),
    labels: text('labels').array().notNull(),
    availableSlots: integer('available_slots').notNull(),
    starting: integer('starting').notNull(),
    running: integer('running').notNull(),
    advertisedAt: timestamp('advertised_at', {withTimezone: true}).notNull().defaultNow(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('runners_provisioner_capability_snapshots_workspace_active_idx').on(
      table.workspaceId,
      table.advertisedAt,
    ),
    index('runners_provisioner_capability_snapshots_provisioner_idx').on(table.provisionerId),
  ],
);

export type ProvisionerCapabilitySnapshotDb = typeof provisionerCapabilitySnapshots.$inferSelect;

export function toProvisionerCapabilitySnapshot(
  row: ProvisionerCapabilitySnapshotDb,
): ProvisionerCapabilitySnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provisionerId: row.provisionerId,
    templateKey: row.templateKey,
    labels: row.labels,
    availableSlots: row.availableSlots,
    starting: row.starting,
    running: row.running,
    advertisedAt: row.advertisedAt,
    createdAt: row.createdAt,
  };
}
