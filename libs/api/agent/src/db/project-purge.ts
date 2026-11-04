import {deleteInBatches, recordDeletedScope} from '@shipfox/node-drizzle';
import {and, asc, eq, isNotNull, isNull, notExists, sql} from 'drizzle-orm';
import type {AgentSession} from '#core/entities/agent-session.js';
import {db} from './db.js';
import {conversations} from './schema/conversations.js';
import {agentDeletedScopes} from './schema/deleted-scopes.js';
import {sessions, toAgentSession} from './schema/sessions.js';
import {turns} from './schema/turns.js';

export async function recordProjectAgentDeleted(params: {
  workspaceId: string;
  projectId: string;
}): Promise<void> {
  await db().transaction((tx) =>
    recordDeletedScope(tx, agentDeletedScopes, {
      scope: {workspaceId: params.workspaceId, projectId: params.projectId},
      reason: 'project_deleted',
    }),
  );
}

/** Deleted projects whose purge has not finished, oldest first. */
export async function listUnpurgedProjectScopes(
  limit: number,
): Promise<{workspaceId: string; projectId: string}[]> {
  const rows = await db()
    .select({
      workspaceId: agentDeletedScopes.workspaceId,
      projectId: agentDeletedScopes.projectId,
    })
    .from(agentDeletedScopes)
    .where(and(isNull(agentDeletedScopes.purgedAt), isNotNull(agentDeletedScopes.projectId)))
    .orderBy(asc(agentDeletedScopes.recordedAt))
    .limit(limit);
  return rows.flatMap((row) =>
    row.projectId === null ? [] : [{workspaceId: row.workspaceId, projectId: row.projectId}],
  );
}

/**
 * Deletes the project's conversations in batches, with their items, turns, stream chunks, run
 * links, and reply deliveries. A conversation with a running turn stays, because the turn is still
 * stopping and would lose its rows mid-write. Returns how many it deleted.
 */
export async function deleteProjectConversations(params: {projectId: string}): Promise<number> {
  const runningTurn = db()
    .select({one: sql`1`})
    .from(turns)
    .where(and(eq(turns.conversationId, conversations.id), eq(turns.status, 'running')));
  return await deleteInBatches({
    db: db(),
    table: conversations,
    where: and(eq(conversations.projectId, params.projectId), notExists(runningTurn)),
  });
}

/** Lists a page of the project's sessions. A deleted session leaves the next page. */
export async function listProjectSessions(params: {
  projectId: string;
  limit: number;
}): Promise<AgentSession[]> {
  const rows = await db()
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, params.projectId))
    .limit(params.limit);
  return rows.map(toAgentSession);
}

/** Sets `purged_at` once no root row of the project remains. Answers whether it did. */
export async function markProjectAgentPurged(params: {
  workspaceId: string;
  projectId: string;
}): Promise<boolean> {
  const remaining = await db().execute(
    sql`select 1 where exists (select 1 from ${conversations} where ${conversations.projectId} = ${params.projectId})
      or exists (select 1 from ${sessions} where ${sessions.projectId} = ${params.projectId})`,
  );
  if (remaining.rows.length > 0) return false;
  await db()
    .update(agentDeletedScopes)
    .set({purgedAt: new Date()})
    .where(
      and(
        eq(agentDeletedScopes.workspaceId, params.workspaceId),
        eq(agentDeletedScopes.projectId, params.projectId),
        isNull(agentDeletedScopes.purgedAt),
      ),
    );
  return true;
}
