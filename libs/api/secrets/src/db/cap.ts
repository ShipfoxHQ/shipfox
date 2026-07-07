import {and, count, eq, notLike, sql} from 'drizzle-orm';
import {db, type Tx} from './db.js';
import {secretValues} from './schema/values.js';
import {secretVariables} from './schema/variables.js';

export async function countWorkspaceEntries(workspaceId: string, tx?: Tx): Promise<number> {
  const executor = tx ?? db();
  const valueRows = await executor
    .select({value: count()})
    .from(secretValues)
    .where(
      and(eq(secretValues.workspaceId, workspaceId), notLike(secretValues.namespace, 'system/%')),
    );
  const variableRows = await executor
    .select({value: count()})
    .from(secretVariables)
    .where(
      and(
        eq(secretVariables.workspaceId, workspaceId),
        notLike(secretVariables.namespace, 'system/%'),
      ),
    );

  return Number(valueRows[0]?.value ?? 0) + Number(variableRows[0]?.value ?? 0);
}

export async function lockWorkspaceEntries(workspaceId: string, tx: Tx): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('shipfox_secrets_workspace_cap'), hashtext(${workspaceId}))
  `);
}
