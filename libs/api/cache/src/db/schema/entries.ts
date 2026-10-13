import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {bigint, index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {CacheEntry} from '#core/entities/cache-entry.js';
import {pgTable} from './common.js';

/**
 * One immutable archive per (project, scope, key, version). The row is the index and the
 * object is opaque data stored under `entry_id`, so user strings never reach an object key.
 * `workspace_id` and `project_id` come from the lease and are opaque ids owned by other modules.
 * `size_bytes` is declared at reserve and checked against the stored object at commit.
 * `last_accessed_at` drives retention and eviction.
 */
export const cacheEntries = pgTable(
  'entries',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    version: text('version').notNull(),
    status: text('status', {enum: ['uploading', 'ready']}).notNull(),
    sizeBytes: bigint('size_bytes', {mode: 'number'}).notNull(),
    sha256: text('sha256').notNull(),
    uploadId: text('upload_id'),
    createdByRunId: uuid('created_by_run_id').notNull(),
    createdByJobExecutionId: uuid('created_by_job_execution_id').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    committedAt: timestamp('committed_at', {withTimezone: true}),
    lastAccessedAt: timestamp('last_accessed_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cache_entries_identity_unique').on(
      table.projectId,
      table.scope,
      table.key,
      table.version,
    ),
    // Prefix lookup walks one (project, scope, version) in key order, newest commit first.
    index('cache_entries_prefix_lookup_idx').on(
      table.projectId,
      table.scope,
      table.version,
      table.key.op('text_pattern_ops'),
      table.committedAt.desc(),
    ),
    index('cache_entries_workspace_last_accessed_idx').on(table.workspaceId, table.lastAccessedAt),
  ],
);

export type CacheEntryDb = typeof cacheEntries.$inferSelect;
export type CacheEntryInsertDb = typeof cacheEntries.$inferInsert;

export function toCacheEntry(row: CacheEntryDb): CacheEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    scope: row.scope,
    key: row.key,
    version: row.version,
    status: row.status,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadId: row.uploadId,
    createdByRunId: row.createdByRunId,
    createdByJobExecutionId: row.createdByJobExecutionId,
    createdAt: row.createdAt,
    committedAt: row.committedAt,
    lastAccessedAt: row.lastAccessedAt,
  };
}
