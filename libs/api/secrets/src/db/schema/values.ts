import {NAMESPACE_PATTERN_SOURCE, SECRET_KEY_PATTERN_SOURCE} from '@shipfox/api-secrets-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable, sqlStringLiteral} from './common.js';

export interface SecretValue {
  id: string;
  workspaceId: string;
  projectId: string | null;
  namespace: string;
  key: string;
  ciphertext: string;
  fingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastEditedBy: string | null;
}

export const secretValues = pgTable(
  'values',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id'),
    namespace: text('namespace').notNull(),
    key: text('key').notNull(),
    ciphertext: text('ciphertext').notNull(),
    fingerprint: text('fingerprint'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    lastEditedBy: uuid('last_edited_by'),
  },
  (table) => [
    uniqueIndex('secrets_values_ws_scope_unique')
      .on(table.workspaceId, table.namespace, table.key)
      .where(sql`"project_id" IS NULL`),
    uniqueIndex('secrets_values_project_scope_unique')
      .on(table.workspaceId, table.projectId, table.namespace, table.key)
      .where(sql`"project_id" IS NOT NULL`),
    index('secrets_values_lookup_idx').on(
      table.workspaceId,
      table.namespace,
      table.projectId,
      table.key,
    ),
    check(
      'secrets_values_key_ck',
      sql`${table.key} ~ ${sqlStringLiteral(SECRET_KEY_PATTERN_SOURCE)}`,
    ),
    check(
      'secrets_values_namespace_ck',
      sql`${table.namespace} = '' OR ${table.namespace} ~ ${sqlStringLiteral(NAMESPACE_PATTERN_SOURCE)}`,
    ),
  ],
);

export type SecretValueDb = typeof secretValues.$inferSelect;
export type SecretValueCreateDb = typeof secretValues.$inferInsert;

export function toSecretValue(row: SecretValueDb): SecretValue {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    namespace: row.namespace,
    key: row.key,
    ciphertext: row.ciphertext,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastEditedBy: row.lastEditedBy,
  };
}
