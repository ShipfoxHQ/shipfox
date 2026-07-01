import {and, asc, eq, gt, inArray, isNull, type SQL} from 'drizzle-orm';
import type {AnyPgColumn} from 'drizzle-orm/pg-core';
import type {Tx} from './db.js';
import {db} from './db.js';
import {type SecretValue, secretValues, toSecretValue} from './schema/values.js';
import {type SecretVariable, secretVariables, toSecretVariable} from './schema/variables.js';
import {normalizedProjectId, type StoreScope} from './scope.js';

export interface ManagementListParams extends StoreScope {
  workspaceId: string;
  limit: number;
  cursor?: string | undefined;
}

export interface SecretManagementListResult {
  secrets: SecretValue[];
  nextCursor: string | null;
}

export interface VariableManagementListResult {
  variables: SecretVariable[];
  nextCursor: string | null;
}

export async function listSecretManagementRows(
  params: ManagementListParams,
  tx?: Tx,
): Promise<SecretManagementListResult> {
  const executor = tx ?? db();
  const rows = await executor
    .select()
    .from(secretValues)
    .where(and(...managementFilters(secretValues, params)))
    .orderBy(asc(secretValues.key))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    secrets: pageRows.map(toSecretValue),
    nextCursor: hasMore && last ? last.key : null,
  };
}

export async function listVariableManagementRows(
  params: ManagementListParams,
  tx?: Tx,
): Promise<VariableManagementListResult> {
  const executor = tx ?? db();
  const rows = await executor
    .select()
    .from(secretVariables)
    .where(and(...managementFilters(secretVariables, params)))
    .orderBy(asc(secretVariables.key))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    variables: pageRows.map(toSecretVariable),
    nextCursor: hasMore && last ? last.key : null,
  };
}

export async function getSecretManagementRow(
  params: StoreScope & {workspaceId: string; key: string},
  tx?: Tx,
): Promise<SecretValue | undefined> {
  const executor = tx ?? db();
  const rows = await executor
    .select()
    .from(secretValues)
    .where(and(...managementFilters(secretValues, params), eq(secretValues.key, params.key)))
    .limit(1);

  const row = rows[0];
  return row ? toSecretValue(row) : undefined;
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
): Promise<SecretValue[]> {
  if (params.keys.length === 0) return [];

  const rows = await tx
    .delete(secretValues)
    .where(and(...managementFilters(secretValues, params), inArray(secretValues.key, params.keys)))
    .returning();

  return rows.map(toSecretValue);
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
