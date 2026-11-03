import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ManagedRepository} from '#db/repositories.js';
import {pgTable} from './common.js';

export const managedRepositories = pgTable(
  'repositories',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    status: text('status').$type<ManagedRepository['status']>().notNull().default('active'),
    linkAttemptId: uuid('link_attempt_id'),
    linkConnectionId: uuid('link_connection_id'),
    linkExternalRepositoryId: text('link_external_repository_id'),
    linkStartedBy: text('link_started_by'),
    linkStartedAt: timestamp('link_started_at', {withTimezone: true}),
    pullRequestUrl: text('pull_request_url'),
    pullRequestNumber: integer('pull_request_number'),
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
    status: row.status,
    link:
      row.linkAttemptId && row.linkConnectionId && row.linkExternalRepositoryId
        ? {
            attemptId: row.linkAttemptId,
            connectionId: row.linkConnectionId,
            externalRepositoryId: row.linkExternalRepositoryId,
            startedBy: row.linkStartedBy,
            startedAt: row.linkStartedAt,
          }
        : null,
    pullRequest:
      row.pullRequestUrl && row.pullRequestNumber !== null
        ? {url: row.pullRequestUrl, number: row.pullRequestNumber}
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
