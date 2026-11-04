import {deletedScopeColumns} from '@shipfox/node-drizzle';
import {unique} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** Marks the projects whose conversations and sessions were deleted, so late writes can't recreate them. */
export const agentDeletedScopes = pgTable('deleted_scopes', deletedScopeColumns(), (table) => [
  unique('agent_deleted_scopes_scope_unique')
    .on(table.workspaceId, table.projectId)
    .nullsNotDistinct(),
]);
