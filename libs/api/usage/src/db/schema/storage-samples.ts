import {sql} from 'drizzle-orm';
import {bigint, index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const usageStorageSamples = pgTable(
  'storage_samples',
  {
    id: uuid('id').notNull().default(sql`uuidv7()`),
    sampleKey: text('sample_key').notNull(),
    source: text('source', {enum: ['cache']}).notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    windowStart: timestamp('window_start', {withTimezone: true}).notNull(),
    windowEnd: timestamp('window_end', {withTimezone: true}).notNull(),
    storedBytes: bigint('stored_bytes', {mode: 'number'}).notNull(),
    objectCount: bigint('object_count', {mode: 'number'}).notNull(),
    recordedAt: timestamp('recorded_at', {withTimezone: true}).notNull(),
  },
  (table) => [
    uniqueIndex('usage_storage_samples_sample_key_recorded_unique').on(
      table.sampleKey,
      table.recordedAt,
    ),
    index('usage_storage_samples_workspace_recorded_idx').on(table.workspaceId, table.recordedAt),
    index('usage_storage_samples_recorded_id_idx').on(table.recordedAt, table.id),
  ],
);

export type UsageStorageSampleDb = typeof usageStorageSamples.$inferSelect;
export type UsageStorageSampleInsertDb = typeof usageStorageSamples.$inferInsert;
