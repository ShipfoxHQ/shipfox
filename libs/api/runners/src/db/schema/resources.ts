import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {Resource} from '#core/entities/resource.js';
import {pgTable} from './common.js';

export const resourceStateEnum = pgEnum('runners_resource_state', [
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
]);

export const resources = pgTable(
  'resources',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    resourceId: text('resource_id').notNull(),
    reservationId: uuid('reservation_id'),
    templateKey: text('template_key'),
    labels: text('labels').array().notNull(),
    state: resourceStateEnum('state').notNull(),
    reason: text('reason'),
    runnerSessionId: uuid('runner_session_id'),
    providerKind: text('provider_kind'),
    reportedAt: timestamp('reported_at', {withTimezone: true}).notNull(),
    reservationReleasedAt: timestamp('reservation_released_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_resources_workspace_provisioner_resource_unique').on(
      table.workspaceId,
      table.provisionerId,
      table.resourceId,
    ),
    index('runners_resources_workspace_state_updated_idx').on(
      table.workspaceId,
      table.state,
      table.updatedAt,
    ),
    index('runners_resources_reservation_id_idx').on(table.reservationId),
  ],
);

export type ResourceDb = typeof resources.$inferSelect;
export type ResourceInsertDb = typeof resources.$inferInsert;

export function toResource(row: ResourceDb): Resource {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provisionerId: row.provisionerId,
    resourceId: row.resourceId,
    reservationId: row.reservationId,
    templateKey: row.templateKey,
    labels: row.labels,
    state: row.state,
    reason: row.reason,
    runnerSessionId: row.runnerSessionId,
    providerKind: row.providerKind,
    reportedAt: row.reportedAt,
    reservationReleasedAt: row.reservationReleasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
