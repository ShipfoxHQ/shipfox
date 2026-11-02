import {foreignKey, primaryKey, text, uuid} from 'drizzle-orm/pg-core';
import {bytea, pgTable} from './common.js';
import {managedRepositories} from './repositories.js';

export const managedObjects = pgTable(
  'objects',
  {
    repositoryId: uuid('repository_id').notNull(),
    oid: text('oid').notNull(),
    data: bytea('data').notNull(),
  },
  (table) => [
    primaryKey({columns: [table.repositoryId, table.oid]}),
    foreignKey({
      name: 'integrations_managed_vcs_objects_repository_fk',
      columns: [table.repositoryId],
      foreignColumns: [managedRepositories.id],
    }).onDelete('cascade'),
  ],
);
