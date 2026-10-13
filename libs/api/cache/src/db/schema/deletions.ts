import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {bigint, index, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {CacheDeletionReason} from '#core/entities/cache-entry.js';
import {pgTable} from './common.js';

/**
 * Why an entry disappeared, kept for 30 days so a user can ask where a cache went.
 * Nothing else reads it.
 */
export const cacheDeletions = pgTable(
  'deletions',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    sizeBytes: bigint('size_bytes', {mode: 'number'}).notNull(),
    reason: text('reason').$type<CacheDeletionReason>().notNull(),
    deletedAt: timestamp('deleted_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('cache_deletions_workspace_deleted_at_idx').on(table.workspaceId, table.deletedAt),
  ],
);
