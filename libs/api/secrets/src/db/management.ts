import {and, asc, eq, gt, inArray, isNull, type SQL, sql} from 'drizzle-orm';
import type {AnyPgColumn} from 'drizzle-orm/pg-core';
import type {Tx} from './db.js';
import {db} from './db.js';
import {type SecretValue, secretValues} from './schema/values.js';
import {type SecretVariable, secretVariables, toSecretVariable} from './schema/variables.js';
import {normalizedProjectId, type StoreScope} from './scope.js';

export interface ManagementListParams extends StoreScope {
  workspaceId: string;
  limit: number;
  cursor?: string | undefined;
}

export type SecretManagementRow = Omit<SecretValue, 'ciphertext' | 'fingerprint'>;

// Values can be large and multi-line, so the list returns only a bounded, single-line
// preview (the value's first line, capped at this many characters). The full value is
// fetched on demand via getVariableManagementRow. This keeps a single-call list of the
// whole bounded set from materializing hundreds of MB server-side.
export const VARIABLE_LIST_VALUE_PREVIEW_LENGTH = 256;

/** A variable list row whose `value` is a preview; `valueTruncated` flags that more exists. */
export interface VariableManagementListRow extends SecretVariable {
  valueTruncated: boolean;
}

export interface SecretManagementListResult {
  secrets: SecretManagementRow[];
  nextCursor: string | null;
}

export interface VariableManagementListResult {
  variables: VariableManagementListRow[];
  nextCursor: string | null;
}

export async function listSecretManagementRows(
  params: ManagementListParams,
  tx?: Tx,
): Promise<SecretManagementListResult> {
  const executor = tx ?? db();
  const rows = await executor
    .select(secretManagementColumns)
    .from(secretValues)
    .where(and(...managementFilters(secretValues, params)))
    .orderBy(asc(secretValues.key))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    secrets: pageRows.map(toSecretManagementRow),
    nextCursor: hasMore && last ? last.key : null,
  };
}

export async function listVariableManagementRows(
  params: ManagementListParams,
  tx?: Tx,
): Promise<VariableManagementListResult> {
  const executor = tx ?? db();
  // Preview = the value's first line, capped at the preview length. `valueTruncated`
  // is true whenever the stored value differs from that preview (longer, or multi-line).
  const valuePreview = sql<string>`left(split_part(${secretVariables.value}, chr(10), 1), ${VARIABLE_LIST_VALUE_PREVIEW_LENGTH})`;
  const rows = await executor
    .select({
      id: secretVariables.id,
      workspaceId: secretVariables.workspaceId,
      projectId: secretVariables.projectId,
      namespace: secretVariables.namespace,
      key: secretVariables.key,
      createdAt: secretVariables.createdAt,
      updatedAt: secretVariables.updatedAt,
      lastEditedBy: secretVariables.lastEditedBy,
      valuePreview,
      valueTruncated: sql<boolean>`${secretVariables.value} <> ${valuePreview}`,
    })
    .from(secretVariables)
    .where(and(...managementFilters(secretVariables, params)))
    .orderBy(asc(secretVariables.key))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    variables: pageRows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      namespace: row.namespace,
      key: row.key,
      value: row.valuePreview,
      valueTruncated: row.valueTruncated,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastEditedBy: row.lastEditedBy,
    })),
    nextCursor: hasMore && last ? last.key : null,
  };
}

export async function getSecretManagementRow(
  params: StoreScope & {workspaceId: string; key: string},
  tx?: Tx,
): Promise<SecretManagementRow | undefined> {
  const executor = tx ?? db();
  const rows = await executor
    .select(secretManagementColumns)
    .from(secretValues)
    .where(and(...managementFilters(secretValues, params), eq(secretValues.key, params.key)))
    .limit(1);

  const row = rows[0];
  return row ? toSecretManagementRow(row) : undefined;
}

export async function getVariableManagementRow(
  params: StoreScope & {workspaceId: string; key: string},
  tx?: Tx,
): Promise<SecretVariable | undefined> {
  const executor = tx ?? db();
  const rows = await executor
    .select()
    .from(secretVariables)
    .where(and(...managementFilters(secretVariables, params), eq(secretVariables.key, params.key)))
    .limit(1);

  const row = rows[0];
  return row ? toSecretVariable(row) : undefined;
}

export async function listExistingSecretManagementKeys(
  params: StoreScope & {workspaceId: string; keys: string[]},
  tx: Tx,
): Promise<Set<string>> {
  if (params.keys.length === 0) return new Set();

  const rows = await tx
    .select({key: secretValues.key})
    .from(secretValues)
    .where(and(...managementFilters(secretValues, params), inArray(secretValues.key, params.keys)));

  return new Set(rows.map((row) => row.key));
}

export async function listExistingVariableManagementKeys(
  params: StoreScope & {workspaceId: string; keys: string[]},
  tx: Tx,
): Promise<Set<string>> {
  if (params.keys.length === 0) return new Set();

  const rows = await tx
    .select({key: secretVariables.key})
    .from(secretVariables)
    .where(
      and(...managementFilters(secretVariables, params), inArray(secretVariables.key, params.keys)),
    );

  return new Set(rows.map((row) => row.key));
}

export async function deleteSecretManagementRows(
  params: StoreScope & {workspaceId: string; keys: string[]},
  tx: Tx,
): Promise<SecretManagementRow[]> {
  if (params.keys.length === 0) return [];

  const rows = await tx
    .delete(secretValues)
    .where(and(...managementFilters(secretValues, params), inArray(secretValues.key, params.keys)))
    .returning(secretManagementColumns);

  return rows.map(toSecretManagementRow);
}

const secretManagementColumns = {
  id: secretValues.id,
  workspaceId: secretValues.workspaceId,
  projectId: secretValues.projectId,
  namespace: secretValues.namespace,
  key: secretValues.key,
  createdAt: secretValues.createdAt,
  updatedAt: secretValues.updatedAt,
  lastEditedBy: secretValues.lastEditedBy,
};

type SecretManagementDbRow =
  typeof secretManagementColumns extends Record<string, infer _Column>
    ? {
        id: string;
        workspaceId: string;
        projectId: string | null;
        namespace: string;
        key: string;
        createdAt: Date;
        updatedAt: Date;
        lastEditedBy: string | null;
      }
    : never;

function toSecretManagementRow(row: SecretManagementDbRow): SecretManagementRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    namespace: row.namespace,
    key: row.key,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastEditedBy: row.lastEditedBy,
  };
}

export async function deleteVariableManagementRows(
  params: StoreScope & {workspaceId: string; keys: string[]},
  tx: Tx,
): Promise<SecretVariable[]> {
  if (params.keys.length === 0) return [];

  const rows = await tx
    .delete(secretVariables)
    .where(
      and(...managementFilters(secretVariables, params), inArray(secretVariables.key, params.keys)),
    )
    .returning();

  return rows.map(toSecretVariable);
}

function managementFilters(
  table: {
    workspaceId: AnyPgColumn;
    projectId: AnyPgColumn;
    namespace: AnyPgColumn;
    key: AnyPgColumn;
  },
  params: StoreScope & {workspaceId: string; cursor?: string | undefined},
): SQL[] {
  const projectId = normalizedProjectId(params);
  const filters = [
    eq(table.workspaceId, params.workspaceId),
    eq(table.namespace, ''),
    projectId ? eq(table.projectId, projectId) : isNull(table.projectId),
  ];
  if (params.cursor) filters.push(gt(table.key, params.cursor));
  return filters;
}
