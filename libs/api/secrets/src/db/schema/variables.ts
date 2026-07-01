import {NAMESPACE_PATTERN_SOURCE, SECRET_KEY_PATTERN_SOURCE} from '@shipfox/api-secrets-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable, sqlStringLiteral} from './common.js';

export interface SecretVariable {
  id: string;
  workspaceId: string;
  projectId: string | null;
  namespace: string;
  key: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
  lastEditedBy: string | null;
}

export const secretVariables = pgTable(
  'variables',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id'),
    namespace: text('namespace').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    lastEditedBy: uuid('last_edited_by'),
  },
  (table) => [
    uniqueIndex('secrets_variables_ws_scope_unique')
      .on(table.workspaceId, table.namespace, table.key)
      .where(sql`"project_id" IS NULL`),
    uniqueIndex('secrets_variables_project_scope_unique')
      .on(table.workspaceId, table.projectId, table.namespace, table.key)
      .where(sql`"project_id" IS NOT NULL`),
    index('secrets_variables_lookup_idx').on(
      table.workspaceId,
      table.namespace,
      table.projectId,
      table.key,
    ),
    check(
      'secrets_variables_key_ck',
      sql`${table.key} ~ ${sqlStringLiteral(SECRET_KEY_PATTERN_SOURCE)}`,
    ),
    check(
      'secrets_variables_namespace_ck',
      sql`char_length(${table.namespace}) <= 128 AND (${table.namespace} = '' OR ${table.namespace} ~ ${sqlStringLiteral(NAMESPACE_PATTERN_SOURCE)})`,
    ),
  ],
);

export type SecretVariableDb = typeof secretVariables.$inferSelect;
export type SecretVariableCreateDb = typeof secretVariables.$inferInsert;

export function toSecretVariable(row: SecretVariableDb): SecretVariable {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    namespace: row.namespace,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastEditedBy: row.lastEditedBy,
  };
}
