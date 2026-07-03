import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ProvisionedRunner} from '#core/entities/provisioned-runner.js';
import {pgTable} from './common.js';

export const provisionedRunnerStateEnum = pgEnum('runners_provisioned_runner_state', [
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
  'terminated',
]);

export const provisionedRunners = pgTable(
  'provisioned_runners',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    provisionedRunnerId: text('provisioned_runner_id').notNull(),
    reservationId: uuid('reservation_id'),
    templateKey: text('template_key'),
    labels: text('labels').array().notNull(),
    state: provisionedRunnerStateEnum('state').notNull(),
    reason: text('reason'),
    runnerSessionId: uuid('runner_session_id'),
    providerKind: text('provider_kind'),
    reportedAt: timestamp('reported_at', {withTimezone: true}).notNull(),
    startedAt: timestamp('started_at', {withTimezone: true}),
    stoppingAt: timestamp('stopping_at', {withTimezone: true}),
    stoppedAt: timestamp('stopped_at', {withTimezone: true}),
    failedAt: timestamp('failed_at', {withTimezone: true}),
    terminatedAt: timestamp('terminated_at', {withTimezone: true}),
    reservationReleasedAt: timestamp('reservation_released_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_provisioned_runners_workspace_provisioner_runner_unique').on(
      table.workspaceId,
      table.provisionerId,
      table.provisionedRunnerId,
    ),
    index('runners_provisioned_runners_workspace_state_updated_idx').on(
      table.workspaceId,
      table.state,
      table.updatedAt,
    ),
    index('runners_provisioned_runners_stale_reaper_idx').on(
      table.state,
      table.updatedAt,
      table.reportedAt,
      table.workspaceId,
    ),
    index('runners_provisioned_runners_reservation_id_idx').on(table.reservationId),
  ],
);

export type ProvisionedRunnerDb = typeof provisionedRunners.$inferSelect;
export type ProvisionedRunnerInsertDb = typeof provisionedRunners.$inferInsert;

export function toProvisionedRunner(row: ProvisionedRunnerDb): ProvisionedRunner {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provisionerId: row.provisionerId,
    provisionedRunnerId: row.provisionedRunnerId,
    reservationId: row.reservationId,
    templateKey: row.templateKey,
    labels: row.labels,
    state: row.state,
    reason: row.reason,
    runnerSessionId: row.runnerSessionId,
    providerKind: row.providerKind,
    reportedAt: row.reportedAt,
    startedAt: row.startedAt,
    stoppingAt: row.stoppingAt,
    stoppedAt: row.stoppedAt,
    failedAt: row.failedAt,
    terminatedAt: row.terminatedAt,
    reservationReleasedAt: row.reservationReleasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
