import {and, eq, lt} from 'drizzle-orm';
import {db} from './db.js';
import {jiraPendingSelections, toJiraPendingSelection} from './schema/pending-selections.js';

export async function saveJiraPendingSelection(params: {
  stateHash: string;
  workspaceId: string;
  expiresAt: Date;
  sites: typeof jiraPendingSelections.$inferInsert.sites;
}): Promise<void> {
  await db()
    .insert(jiraPendingSelections)
    .values(params)
    .onConflictDoUpdate({
      target: jiraPendingSelections.stateHash,
      set: {workspaceId: params.workspaceId, expiresAt: params.expiresAt, sites: params.sites},
    });
}

export async function getJiraPendingSelection(params: {stateHash: string; workspaceId: string}) {
  const rows = await db()
    .select()
    .from(jiraPendingSelections)
    .where(
      and(
        eq(jiraPendingSelections.stateHash, params.stateHash),
        eq(jiraPendingSelections.workspaceId, params.workspaceId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toJiraPendingSelection(row) : undefined;
}

export async function deleteJiraPendingSelection(params: {
  stateHash: string;
  workspaceId: string;
}): Promise<void> {
  await db()
    .delete(jiraPendingSelections)
    .where(
      and(
        eq(jiraPendingSelections.stateHash, params.stateHash),
        eq(jiraPendingSelections.workspaceId, params.workspaceId),
      ),
    );
}

export async function listExpiredJiraPendingSelections(now: Date) {
  const rows = await db()
    .select()
    .from(jiraPendingSelections)
    .where(lt(jiraPendingSelections.expiresAt, now));
  return rows.map(toJiraPendingSelection);
}
