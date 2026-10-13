import {integer, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** A workspace with no row uses the default retention. */
export const cacheWorkspaceSettings = pgTable('workspace_settings', {
  workspaceId: uuid('workspace_id').primaryKey(),
  retentionDays: integer('retention_days').notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});
