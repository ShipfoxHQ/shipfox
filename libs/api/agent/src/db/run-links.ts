import type {Buffer} from 'node:buffer';
import {and, eq, isNotNull, lt, sql} from 'drizzle-orm';
import type {ConversationItemMeta} from '#core/entities/conversation.js';
import {db} from './db.js';
import {conversationItems} from './schema/conversation-items.js';
import {conversationRunLinks} from './schema/conversation-run-links.js';
import {conversations} from './schema/conversations.js';

/**
 * Links a run to the conversation that started it, with a check requested, so a run that ended
 * before this call, or a crash right after it, still delivers. A repeat changes nothing.
 */
export async function registerConversationRun(params: {
  workspaceId: string;
  conversationId: string;
  workflowRunId: string;
}): Promise<boolean> {
  return await db().transaction(async (tx) => {
    const owned = await tx
      .select({id: conversations.id})
      .from(conversations)
      .where(
        and(
          eq(conversations.id, params.conversationId),
          eq(conversations.workspaceId, params.workspaceId),
        ),
      )
      .for('share');
    if (owned.length === 0) return false;

    await tx
      .insert(conversationRunLinks)
      .values({
        conversationId: params.conversationId,
        workflowRunId: params.workflowRunId,
        checkRequestedAt: sql`NOW()`,
      })
      .onConflictDoNothing();
    return true;
  });
}

/** Marks every link of a run as changed since its last check. Most runs have none. */
export async function requestRunLinkChecks(workflowRunId: string): Promise<number> {
  const rows = await db()
    .update(conversationRunLinks)
    .set({checkRequestedAt: sql`NOW()`})
    .where(eq(conversationRunLinks.workflowRunId, workflowRunId))
    .returning({conversationId: conversationRunLinks.conversationId});
  return rows.length;
}

export interface RunLinkCheck {
  conversationId: string;
  workspaceId: string;
  /**
   * The request time as text. A timestamp keeps microseconds that a `Date` drops, so the value
   * goes back to Postgres as it came out, and a clear matches only an unchanged request.
   */
  checkRequestedAt: string;
}

/** The links of a run that have a check requested, with the conversation's workspace. */
export async function listRunLinkChecks(workflowRunId: string): Promise<RunLinkCheck[]> {
  const rows = await db()
    .select({
      conversationId: conversationRunLinks.conversationId,
      workspaceId: conversations.workspaceId,
      checkRequestedAt: sql<string>`${conversationRunLinks.checkRequestedAt}::text`,
    })
    .from(conversationRunLinks)
    .innerJoin(conversations, eq(conversations.id, conversationRunLinks.conversationId))
    .where(
      and(
        eq(conversationRunLinks.workflowRunId, workflowRunId),
        isNotNull(conversationRunLinks.checkRequestedAt),
      ),
    );
  return rows;
}

/** Runs with a link whose check has waited longer than `olderThanMs`, oldest request first. */
export async function listRunsWithStaleChecks(params: {
  olderThanMs: number;
  limit: number;
}): Promise<string[]> {
  const rows = await db()
    .select({
      workflowRunId: conversationRunLinks.workflowRunId,
      oldest: sql<string>`MIN(${conversationRunLinks.checkRequestedAt})`,
    })
    .from(conversationRunLinks)
    .where(
      lt(
        conversationRunLinks.checkRequestedAt,
        sql`NOW() - (${params.olderThanMs} * INTERVAL '1 millisecond')`,
      ),
    )
    .groupBy(conversationRunLinks.workflowRunId)
    .orderBy(sql`MIN(${conversationRunLinks.checkRequestedAt})`)
    .limit(params.limit);
  return rows.map((row) => row.workflowRunId);
}

export interface NewRunResultEntry {
  id: string;
  runAttemptId: string;
  sessionVersion: number;
  sealedEntry: Buffer;
  meta: ConversationItemMeta;
}

/** Clears the request, but only when it still has the value the check saw. */
function clearCheck(
  tx: Pick<ReturnType<typeof db>, 'update'>,
  params: {conversationId: string; workflowRunId: string; checkRequestedAt: string},
) {
  return tx
    .update(conversationRunLinks)
    .set({checkRequestedAt: null})
    .where(
      and(
        eq(conversationRunLinks.conversationId, params.conversationId),
        eq(conversationRunLinks.workflowRunId, params.workflowRunId),
        sql`${conversationRunLinks.checkRequestedAt}::text = ${params.checkRequestedAt}`,
      ),
    );
}

/**
 * Queues the result of a run attempt in a conversation and clears the check in one transaction,
 * so a crash can't leave a result delivered with its check still requested, or the reverse. The
 * unique index on the attempt makes a repeat insert nothing. Returns whether this call queued it.
 */
export async function queueRunResult(params: {
  conversationId: string;
  workflowRunId: string;
  checkRequestedAt: string;
  entry: NewRunResultEntry;
}): Promise<boolean> {
  return await db().transaction(async (tx) => {
    // An exclusive lock, because a shared one lets two deliveries each wait on the other's
    // update below. It also keeps a delete from racing the insert into a conversation going away.
    const locked = await tx
      .select({id: conversations.id})
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .for('update');
    if (locked.length === 0) return false;

    const inserted = await tx
      .insert(conversationItems)
      .values({
        id: params.entry.id,
        conversationId: params.conversationId,
        entryType: 'custom_message',
        sessionVersion: params.entry.sessionVersion,
        runAttemptId: params.entry.runAttemptId,
        body: params.entry.sealedEntry,
        meta: params.entry.meta,
      })
      .onConflictDoNothing({
        target: [conversationItems.conversationId, conversationItems.runAttemptId],
        where: sql`"run_attempt_id" IS NOT NULL`,
      })
      .returning({id: conversationItems.id});
    if (inserted.length > 0) {
      await tx
        .update(conversations)
        .set({lastActivityAt: sql`NOW()`})
        .where(eq(conversations.id, params.conversationId));
    }
    await clearCheck(tx, params);
    return inserted.length > 0;
  });
}

/** Clears checks that have nothing to deliver yet, or whose run no longer exists. */
export async function clearRunLinkCheck(params: {
  conversationId: string;
  workflowRunId: string;
  checkRequestedAt: string;
}): Promise<void> {
  await clearCheck(db(), params);
}
