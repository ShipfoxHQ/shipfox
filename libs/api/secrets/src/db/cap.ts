import {and, count, eq, notLike, sql} from 'drizzle-orm';
import {db, type Tx} from './db.js';
import {secretValues} from './schema/values.js';
import {secretVariables} from './schema/variables.js';

export async function countWorkspaceEntries(workspaceId: string, tx?: Tx): Promise<number> {
  const executor = tx ?? db();
  const valueCount = executor
    .select({count: count().as('value_count')})
    .from(secretValues)
    .where(
      and(eq(secretValues.workspaceId, workspaceId), notLike(secretValues.namespace, 'system/%')),
    )
    .as('value_count');
  const variableCount = executor
    .select({count: count().as('variable_count')})
    .from(secretVariables)
    .where(
      and(
        eq(secretVariables.workspaceId, workspaceId),
        notLike(secretVariables.namespace, 'system/%'),
      ),
    )
    .as('variable_count');
  const [row] = await executor
    .select({value: sql<number>`${valueCount.count} + ${variableCount.count}`})
    .from(valueCount)
    .crossJoin(variableCount);

  return Number(row?.value ?? 0);
}

export async function countPublicEntriesByResource(
  tx?: Tx,
): Promise<{secrets: number; variables: number}> {
  const executor = tx ?? db();
  const [secretCount, variableCount] = await Promise.all([
    executor
      .select({count: count().as('secret_count')})
      .from(secretValues)
      .where(notLike(secretValues.namespace, 'system/%')),
    executor
      .select({count: count().as('variable_count')})
      .from(secretVariables)
      .where(notLike(secretVariables.namespace, 'system/%')),
  ]);

  return {
    secrets: Number(secretCount[0]?.count ?? 0),
    variables: Number(variableCount[0]?.count ?? 0),
  };
}

export async function lockWorkspaceEntries(workspaceId: string, tx: Tx): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('shipfox_secrets_workspace_cap'), hashtext(${workspaceId}))
  `);
}
