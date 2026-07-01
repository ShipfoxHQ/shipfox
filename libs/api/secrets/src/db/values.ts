import {and, eq, inArray, isNull, sql} from 'drizzle-orm';
import {db, type Tx} from './db.js';
import {type SecretValue, secretValues, toSecretValue} from './schema/values.js';
import {
  lookupWithPrecedenceWhere,
  normalizedProjectId,
  type StoreScope,
  scopeConflictTargetWhere,
  scopeExactWhere,
} from './scope.js';

export interface SecretValueWrite {
  workspaceId: string;
  projectId: string | null;
  namespace: string;
  key: string;
  ciphertext: string;
  fingerprint: string | null;
  lastEditedBy?: string | null | undefined;
}

export async function getSecretValueRowWithPrecedence(
  params: StoreScope & {workspaceId: string; namespace: string; key: string},
  tx?: Tx,
): Promise<SecretValue | undefined> {
  const executor = tx ?? db();
  const rows = await executor
    .select()
    .from(secretValues)
    .where(
      lookupWithPrecedenceWhere(
        {
          workspaceId: secretValues.workspaceId,
          projectId: secretValues.projectId,
          namespace: secretValues.namespace,
          key: secretValues.key,
        },
        params,
      ),
    )
    .orderBy(sql`${secretValues.projectId} NULLS LAST`)
    .limit(1);
  const row = rows[0];
  return row ? toSecretValue(row) : undefined;
}

export async function listSecretValueRowsByNamespace(
  params: StoreScope & {workspaceId: string; namespace: string},
  tx?: Tx,
): Promise<SecretValue[]> {
  const executor = tx ?? db();
  const rows = await executor.execute<SecretValueRow>(sql`
    SELECT DISTINCT ON (key)
      id, workspace_id, project_id, namespace, key, ciphertext, fingerprint,
      created_at, updated_at, last_edited_by
    FROM secrets_values
    WHERE ${listByNamespaceSql(params)}
    ORDER BY key, project_id NULLS LAST, id
  `);
  return rows.rows.map(rowToSecretValue);
}

export async function upsertSecretValueRows(rows: SecretValueWrite[], tx: Tx): Promise<void> {
  if (rows.length === 0) return;
  const projectId = batchProjectId(rows);
  await tx
    .insert(secretValues)
    .values(rows)
    .onConflictDoUpdate({
      target: projectId
        ? [
            secretValues.workspaceId,
            secretValues.projectId,
            secretValues.namespace,
            secretValues.key,
          ]
        : [secretValues.workspaceId, secretValues.namespace, secretValues.key],
      targetWhere: scopeConflictTargetWhere({projectId}),
      set: {
        ciphertext: sql`excluded.ciphertext`,
        fingerprint: sql`excluded.fingerprint`,
        lastEditedBy: sql`excluded.last_edited_by`,
        updatedAt: sql`NOW()`,
      },
    });
}

export async function countSecretValueRows(
  params: StoreScope & {workspaceId: string; namespace: string; keys: string[]},
  tx: Tx,
): Promise<number> {
  if (params.keys.length === 0) return 0;

  const rows = await tx
    .select({count: sql<string | number>`COUNT(*)`})
    .from(secretValues)
    .where(
      and(
        eq(secretValues.workspaceId, params.workspaceId),
        eq(secretValues.namespace, params.namespace),
        scopeExactWhere(
          {
            workspaceId: secretValues.workspaceId,
            projectId: secretValues.projectId,
            namespace: secretValues.namespace,
            key: secretValues.key,
          },
          params,
        ) ?? isNull(secretValues.projectId),
        inArray(secretValues.key, params.keys),
      ),
    );

  return Number(rows[0]?.count ?? 0);
}

export async function deleteSecretValueRows(
  params: StoreScope & {workspaceId: string; namespace: string; keys?: string[] | undefined},
  tx?: Tx,
): Promise<number> {
  if (params.keys && params.keys.length === 0) return 0;

  const executor = tx ?? db();
  const filters = [
    eq(secretValues.workspaceId, params.workspaceId),
    eq(secretValues.namespace, params.namespace),
    scopeExactWhere(
      {
        workspaceId: secretValues.workspaceId,
        projectId: secretValues.projectId,
        namespace: secretValues.namespace,
        key: secretValues.key,
      },
      params,
    ) ?? isNull(secretValues.projectId),
  ];
  if (params.keys && params.keys.length > 0) {
    filters.push(inArray(secretValues.key, params.keys));
  }
  const deleted = await executor
    .delete(secretValues)
    .where(and(...filters))
    .returning({id: secretValues.id});
  return deleted.length;
}

function batchProjectId(rows: SecretValueWrite[]): string | null {
  const projectId = normalizedProjectId({projectId: rows[0]?.projectId});
  const mixedScope = rows.some(
    (row) => normalizedProjectId({projectId: row.projectId}) !== projectId,
  );
  if (mixedScope) throw new Error('Secret value batch must target a single project scope.');
  return projectId;
}

function listByNamespaceSql(params: StoreScope & {workspaceId: string; namespace: string}) {
  const projectId = normalizedProjectId(params);
  if (!projectId) {
    return sql`workspace_id = ${params.workspaceId} AND namespace = ${params.namespace} AND project_id IS NULL`;
  }
  return sql`workspace_id = ${params.workspaceId} AND namespace = ${params.namespace} AND (project_id = ${projectId} OR project_id IS NULL)`;
}

interface SecretValueRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  project_id: string | null;
  namespace: string;
  key: string;
  ciphertext: string;
  fingerprint: string | null;
  created_at: Date;
  updated_at: Date;
  last_edited_by: string | null;
}

function rowToSecretValue(row: SecretValueRow): SecretValue {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    namespace: row.namespace,
    key: row.key,
    ciphertext: row.ciphertext,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEditedBy: row.last_edited_by,
  };
}
