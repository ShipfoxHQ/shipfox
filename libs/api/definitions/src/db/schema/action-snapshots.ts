import type {Buffer} from 'node:buffer';
import {customType, integer, jsonb, primaryKey, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {ActionSnapshot, ActionSnapshotSource} from '#core/entities/action-snapshot.js';
import {pgTable} from './common.js';

// drizzle-orm has no native bytea column; node-postgres reads and writes bytea as Buffer.
const bytea = customType<{data: Buffer; driverData: Buffer}>({
  dataType() {
    return 'bytea';
  },
});

export const definitionActionSnapshots = pgTable(
  'action_snapshots',
  {
    workspaceId: uuid('workspace_id').notNull(),
    digest: text('digest').notNull(),
    projectId: uuid('project_id').notNull(),
    manifest: jsonb('manifest').notNull().$type<Record<string, unknown>>(),
    bundle: bytea('bundle').notNull(),
    fileCount: integer('file_count').notNull(),
    bytes: integer('bytes').notNull(),
    source: text('source').notNull().$type<ActionSnapshotSource>(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'definitions_action_snapshots_pkey',
      columns: [table.workspaceId, table.digest],
    }),
  ],
);

export type ActionSnapshotDb = typeof definitionActionSnapshots.$inferSelect;

export function toActionSnapshot(row: ActionSnapshotDb): ActionSnapshot {
  return {...row, bundle: new Uint8Array(row.bundle)};
}
