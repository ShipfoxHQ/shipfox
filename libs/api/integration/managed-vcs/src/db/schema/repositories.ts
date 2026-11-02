import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ManagedRepository} from '#db/repositories.js';
import {pgTable} from './common.js';

export const managedRepositories = pgTable(
  'repositories',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_managed_vcs_repositories_project_unique').on(table.projectId),
    index('integrations_managed_vcs_repositories_workspace_idx').on(table.workspaceId, table.id),
  ],
);

export type ManagedRepositoryDb = typeof managedRepositories.$inferSelect;

export function toManagedRepository(row: ManagedRepositoryDb): ManagedRepository {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
