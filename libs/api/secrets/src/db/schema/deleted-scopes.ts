import {deletedScopeColumns} from '@shipfox/node-drizzle';
import {unique} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** Marks the projects whose secrets and variables were deleted, so late writes can't recreate them. */
export const secretsDeletedScopes = pgTable('deleted_scopes', deletedScopeColumns(), (table) => [
  unique('secrets_deleted_scopes_scope_unique')
    .on(table.workspaceId, table.projectId)
    .nullsNotDistinct(),
]);
