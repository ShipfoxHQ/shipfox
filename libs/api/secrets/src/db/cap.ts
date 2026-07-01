import {sql} from 'drizzle-orm';
import {db, type Tx} from './db.js';

export async function countWorkspaceEntries(workspaceId: string, tx?: Tx): Promise<number> {
  const executor = tx ?? db();
  const result = await executor.execute<{count: string | number}>(sql`
    SELECT
      (SELECT COUNT(*) FROM secrets_values WHERE workspace_id = ${workspaceId}) +
      (SELECT COUNT(*) FROM secrets_variables WHERE workspace_id = ${workspaceId}) AS count
  `);
  const count = result.rows[0]?.count ?? 0;
  return Number(count);
}

export async function lockWorkspaceEntries(workspaceId: string, tx: Tx): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('shipfox_secrets_workspace_cap'), hashtext(${workspaceId}))
  `);
}
