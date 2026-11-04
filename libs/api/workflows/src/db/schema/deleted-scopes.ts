import {deletedScopeColumns} from '@shipfox/node-drizzle';
import {unique} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** Markers of deleted workspaces and projects. A guarded write to a marked scope is refused. */
export const workflowsDeletedScopes = pgTable('deleted_scopes', deletedScopeColumns(), (table) => [
  unique('workflows_deleted_scopes_scope_unique')
    .on(table.workspaceId, table.projectId)
    .nullsNotDistinct(),
]);
