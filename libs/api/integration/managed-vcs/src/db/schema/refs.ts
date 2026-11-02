import {foreignKey, primaryKey, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {managedObjects} from './objects.js';
import {managedRepositories} from './repositories.js';

export const managedRefs = pgTable(
  'refs',
  {
    repositoryId: uuid('repository_id').notNull(),
    name: text('name').notNull(),
    commitOid: text('commit_oid').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({columns: [table.repositoryId, table.name]}),
    foreignKey({
      name: 'integrations_managed_vcs_refs_repository_fk',
      columns: [table.repositoryId],
      foreignColumns: [managedRepositories.id],
    }).onDelete('cascade'),
    // Cascades so deleting a repository stays one statement, whichever cascade runs first.
    foreignKey({
      name: 'integrations_managed_vcs_refs_commit_fk',
      columns: [table.repositoryId, table.commitOid],
      foreignColumns: [managedObjects.repositoryId, managedObjects.oid],
    }).onDelete('cascade'),
  ],
);
