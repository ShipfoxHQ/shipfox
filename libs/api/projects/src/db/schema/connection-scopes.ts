import {index, primaryKey, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {projects} from './projects.js';

export type ConnectionResourceScope = 'all' | 'selected';

/**
 * One row per connection a project lists in its access. Rows exist only while the project's
 * `connection_access` is `selected`. The connection id is opaque, because the connection belongs
 * to the integrations module.
 */
export const projectsConnectionScopes = pgTable(
  'connection_scopes',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, {onDelete: 'cascade'}),
    connectionId: uuid('connection_id').notNull(),
    resourceScope: text('resource_scope').$type<ConnectionResourceScope>().notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'projects_connection_scopes_pk',
      columns: [table.projectId, table.connectionId],
    }),
    index('projects_connection_scopes_connection_idx').on(table.connectionId),
  ],
);

export type ConnectionScopeDb = typeof projectsConnectionScopes.$inferSelect;
