import {deletedScopeColumns} from '@shipfox/node-drizzle';
import {unique} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** Marks the projects whose cache entries were deleted, so a late reserve can't recreate them. */
export const cacheDeletedScopes = pgTable('deleted_scopes', deletedScopeColumns(), (table) => [
  unique('cache_deleted_scopes_scope_unique')
    .on(table.workspaceId, table.projectId)
    .nullsNotDistinct(),
]);
