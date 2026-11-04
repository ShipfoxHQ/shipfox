import {deletedScopeColumns} from '@shipfox/node-drizzle';
import {unique} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** Projects whose rows this module purged or is purging. A late event cannot recreate them. */
export const triggersDeletedScopes = pgTable('deleted_scopes', deletedScopeColumns(), (table) => [
  unique('triggers_deleted_scopes_scope_unique')
    .on(table.workspaceId, table.projectId)
    .nullsNotDistinct(),
]);
