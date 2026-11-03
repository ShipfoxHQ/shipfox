import {foreignKey, index, primaryKey, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {projectsConnectionScopes} from './connection-scopes.js';

/**
 * One row per resource of a connection scope that is limited to some resources. `lookup_name` is
 * the lowercase key that name targets match, and `display_name` is as the provider returns it.
 */
export const projectsConnectionResources = pgTable(
  'connection_resources',
  {
    projectId: uuid('project_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    resourceKind: text('resource_kind').notNull(),
    externalResourceId: text('external_resource_id').notNull(),
    lookupName: text('lookup_name').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'projects_connection_resources_pk',
      columns: [table.projectId, table.connectionId, table.resourceKind, table.externalResourceId],
    }),
    foreignKey({
      name: 'projects_connection_resources_scope_fk',
      columns: [table.projectId, table.connectionId],
      foreignColumns: [projectsConnectionScopes.projectId, projectsConnectionScopes.connectionId],
    }).onDelete('cascade'),
    index('projects_connection_resources_lookup_idx').on(
      table.projectId,
      table.connectionId,
      table.resourceKind,
      table.lookupName,
    ),
    index('projects_connection_resources_external_idx').on(
      table.connectionId,
      table.resourceKind,
      table.externalResourceId,
    ),
  ],
);

export type ConnectionResourceDb = typeof projectsConnectionResources.$inferSelect;
