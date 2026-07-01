import {and, eq, gt, inArray, notInArray, type SQL, sql} from 'drizzle-orm';
import {db, type Tx} from './db.js';
import {type DataKey, secretDataKeys, toDataKey} from './schema/data-keys.js';

export async function getDataKey(workspaceId: string, tx?: Tx): Promise<DataKey | undefined> {
  const executor = tx ?? db();
  const rows = await executor
    .select()
    .from(secretDataKeys)
    .where(eq(secretDataKeys.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  return row ? toDataKey(row) : undefined;
}

export async function insertDataKeyIfAbsent(
  dataKey: {workspaceId: string; wrappedDek: string; kekVersion: string},
  tx?: Tx,
): Promise<void> {
  const executor = tx ?? db();
  await executor.insert(secretDataKeys).values(dataKey).onConflictDoNothing({
    target: secretDataKeys.workspaceId,
  });
}

export async function updateDataKeyWrapCas(
  params: {workspaceId: string; oldKekVersion: string; wrappedDek: string; kekVersion: string},
  tx?: Tx,
): Promise<boolean> {
  const executor = tx ?? db();
  const rows = await executor
    .update(secretDataKeys)
    .set({
      wrappedDek: params.wrappedDek,
      kekVersion: params.kekVersion,
      rotatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(secretDataKeys.workspaceId, params.workspaceId),
        eq(secretDataKeys.kekVersion, params.oldKekVersion),
      ),
    )
    .returning({workspaceId: secretDataKeys.workspaceId});
  return rows.length > 0;
}

export async function listDataKeyVersions(knownVersions: string[]): Promise<string[]> {
  if (knownVersions.length === 0) {
    const rows = await db()
      .selectDistinct({kekVersion: secretDataKeys.kekVersion})
      .from(secretDataKeys);
    return rows.map((row) => row.kekVersion);
  }

  const rows = await db()
    .selectDistinct({kekVersion: secretDataKeys.kekVersion})
    .from(secretDataKeys)
    .where(notInArray(secretDataKeys.kekVersion, knownVersions));
  return rows.map((row) => row.kekVersion);
}

export async function listDataKeysPage(params: {
  afterWorkspaceId?: string | undefined;
  limit: number;
  versions?: string[] | undefined;
}): Promise<DataKey[]> {
  if (params.versions && params.versions.length === 0) return [];

  const filters: SQL[] = [];
  if (params.afterWorkspaceId) {
    filters.push(gt(secretDataKeys.workspaceId, params.afterWorkspaceId));
  }
  if (params.versions) {
    filters.push(inArray(secretDataKeys.kekVersion, params.versions));
  }
  const rows = await db()
    .select()
    .from(secretDataKeys)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(secretDataKeys.workspaceId)
    .limit(params.limit);
  return rows.map(toDataKey);
}
