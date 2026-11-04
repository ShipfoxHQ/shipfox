import {deleteInBatches, recordDeletedScope} from '@shipfox/node-drizzle';
import {and, eq, isNull, sql} from 'drizzle-orm';
import {db} from './db.js';
import {secretsDeletedScopes} from './schema/deleted-scopes.js';
import {secretValues} from './schema/values.js';
import {secretVariables} from './schema/variables.js';

export async function recordProjectSecretsDeleted(params: {
  workspaceId: string;
  projectId: string;
}): Promise<void> {
  await db().transaction((tx) =>
    recordDeletedScope(tx, secretsDeletedScopes, {
      scope: {workspaceId: params.workspaceId, projectId: params.projectId},
      reason: 'project_deleted',
    }),
  );
}

/** Deletes the project's secrets and variables in batches. Workspace-level rows stay. */
export async function deleteProjectSecretRows(params: {
  projectId: string;
}): Promise<{secrets: number; variables: number}> {
  const secrets = await deleteInBatches({
    db: db(),
    table: secretValues,
    where: eq(secretValues.projectId, params.projectId),
  });
  const variables = await deleteInBatches({
    db: db(),
    table: secretVariables,
    where: eq(secretVariables.projectId, params.projectId),
  });
  return {secrets, variables};
}

/** Sets `purged_at` once no root row of the project remains. Answers whether it did. */
export async function markProjectSecretsPurged(params: {
  workspaceId: string;
  projectId: string;
}): Promise<boolean> {
  const remaining = await db().execute(
    sql`select 1 where exists (select 1 from ${secretValues} where ${secretValues.projectId} = ${params.projectId})
      or exists (select 1 from ${secretVariables} where ${secretVariables.projectId} = ${params.projectId})`,
  );
  if (remaining.rows.length > 0) return false;
  await db()
    .update(secretsDeletedScopes)
    .set({purgedAt: new Date()})
    .where(
      and(
        eq(secretsDeletedScopes.workspaceId, params.workspaceId),
        eq(secretsDeletedScopes.projectId, params.projectId),
        isNull(secretsDeletedScopes.purgedAt),
      ),
    );
  return true;
}
