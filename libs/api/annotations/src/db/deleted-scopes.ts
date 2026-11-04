import {deleteInBatches, recordDeletedScope} from '@shipfox/node-drizzle';
import {and, count, eq, isNull, sql} from 'drizzle-orm';
import {db} from './db.js';
import {annotations} from './schema/annotations.js';
import {annotationsDeletedScopes} from './schema/deleted-scopes.js';

export interface DeletedProjectScope {
  workspaceId: string;
  projectId: string;
}

export async function recordProjectDeleted(
  scope: DeletedProjectScope,
  reason: string,
): Promise<void> {
  await db().transaction((tx) => recordDeletedScope(tx, annotationsDeletedScopes, {scope, reason}));
}

export function deleteProjectAnnotations(scope: DeletedProjectScope): Promise<number> {
  return deleteInBatches({
    db: db(),
    table: annotations,
    where: and(
      eq(annotations.workspaceId, scope.workspaceId),
      eq(annotations.projectId, scope.projectId),
    ),
  });
}

export async function countProjectAnnotations(scope: DeletedProjectScope): Promise<number> {
  const [row] = await db()
    .select({value: count()})
    .from(annotations)
    .where(
      and(
        eq(annotations.workspaceId, scope.workspaceId),
        eq(annotations.projectId, scope.projectId),
      ),
    );
  return row?.value ?? 0;
}

export async function markProjectPurged(scope: DeletedProjectScope): Promise<void> {
  await db()
    .update(annotationsDeletedScopes)
    .set({purgedAt: sql`now()`})
    .where(
      and(
        eq(annotationsDeletedScopes.workspaceId, scope.workspaceId),
        eq(annotationsDeletedScopes.projectId, scope.projectId),
        isNull(annotationsDeletedScopes.purgedAt),
      ),
    );
}
