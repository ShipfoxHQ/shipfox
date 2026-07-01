import {and, eq, inArray, isNull, sql} from 'drizzle-orm';
import {db, type Tx} from './db.js';
import {type SecretVariable, secretVariables, toSecretVariable} from './schema/variables.js';
import {
  lookupWithPrecedenceWhere,
  normalizedProjectId,
  type StoreScope,
  scopeConflictTargetWhere,
  scopeExactWhere,
} from './scope.js';

export interface SecretVariableWrite {
  workspaceId: string;
  projectId: string | null;
  namespace: string;
  key: string;
  value: string;
  lastEditedBy?: string | null | undefined;
}

export async function getSecretVariableRowWithPrecedence(
  params: StoreScope & {workspaceId: string; namespace: string; key: string},
  tx?: Tx,
): Promise<SecretVariable | undefined> {
  const executor = tx ?? db();
  const rows = await executor
    .select()
    .from(secretVariables)
    .where(
      lookupWithPrecedenceWhere(
        {
          workspaceId: secretVariables.workspaceId,
          projectId: secretVariables.projectId,
          namespace: secretVariables.namespace,
          key: secretVariables.key,
        },
        params,
      ),
    )
    .orderBy(sql`${secretVariables.projectId} NULLS LAST`)
    .limit(1);
  const row = rows[0];
  return row ? toSecretVariable(row) : undefined;
}

export async function listSecretVariableRowsByNamespace(
  params: StoreScope & {workspaceId: string; namespace: string},
  tx?: Tx,
): Promise<SecretVariable[]> {
  const executor = tx ?? db();
  const rows = await executor.execute<SecretVariableRow>(sql`
    SELECT DISTINCT ON (key)
      id, workspace_id, project_id, namespace, key, value,
      created_at, updated_at, last_edited_by
    FROM secrets_variables
    WHERE ${listByNamespaceSql(params)}
    ORDER BY key, project_id NULLS LAST, id
  `);
  return rows.rows.map(rowToSecretVariable);
}

export async function upsertSecretVariableRows(rows: SecretVariableWrite[], tx: Tx): Promise<void> {
  if (rows.length === 0) return;
  const projectId = normalizedProjectId({projectId: rows[0]?.projectId});
  await tx
    .insert(secretVariables)
    .values(rows)
    .onConflictDoUpdate({
      target: projectId
        ? [
            secretVariables.workspaceId,
            secretVariables.projectId,
            secretVariables.namespace,
            secretVariables.key,
          ]
        : [secretVariables.workspaceId, secretVariables.namespace, secretVariables.key],
      targetWhere: scopeConflictTargetWhere({projectId}),
      set: {
        value: sql`excluded.value`,
        lastEditedBy: sql`excluded.last_edited_by`,
        updatedAt: sql`NOW()`,
      },
    });
}

export async function deleteSecretVariableRows(
  params: StoreScope & {workspaceId: string; namespace: string; keys?: string[] | undefined},
  tx?: Tx,
): Promise<number> {
  const executor = tx ?? db();
  const filters = [
    eq(secretVariables.workspaceId, params.workspaceId),
    eq(secretVariables.namespace, params.namespace),
    scopeExactWhere(
      {
        workspaceId: secretVariables.workspaceId,
        projectId: secretVariables.projectId,
        namespace: secretVariables.namespace,
        key: secretVariables.key,
      },
      params,
    ) ?? isNull(secretVariables.projectId),
  ];
  if (params.keys && params.keys.length > 0) {
    filters.push(inArray(secretVariables.key, params.keys));
  }
  const deleted = await executor
    .delete(secretVariables)
    .where(and(...filters))
    .returning({id: secretVariables.id});
  return deleted.length;
}

function listByNamespaceSql(params: StoreScope & {workspaceId: string; namespace: string}) {
  const projectId = normalizedProjectId(params);
  if (!projectId) {
    return sql`workspace_id = ${params.workspaceId} AND namespace = ${params.namespace} AND project_id IS NULL`;
  }
  return sql`workspace_id = ${params.workspaceId} AND namespace = ${params.namespace} AND (project_id = ${projectId} OR project_id IS NULL)`;
}

interface SecretVariableRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  project_id: string | null;
  namespace: string;
  key: string;
  value: string;
  created_at: Date;
  updated_at: Date;
  last_edited_by: string | null;
}

function rowToSecretVariable(row: SecretVariableRow): SecretVariable {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    namespace: row.namespace,
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEditedBy: row.last_edited_by,
  };
}
