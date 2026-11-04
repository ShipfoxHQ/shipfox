import type {Buffer} from 'node:buffer';
import {and, asc, desc, eq, gte, inArray, isNotNull, isNull, notExists, or, sql} from 'drizzle-orm';
import {
  type AgentTurn,
  type Conversation,
  type ConversationItem,
  type ConversationItemMeta,
  TURN_NOTICE_CUSTOM_TYPE,
} from '#core/entities/conversation.js';
import {claimQueuedConversationItemsInTransaction} from './conversations.js';
import {db, type Transaction} from './db.js';
import {conversationItems, toConversationItem} from './schema/conversation-items.js';
import {conversations, toConversation} from './schema/conversations.js';
import {replyDeliveries} from './schema/reply-deliveries.js';
import {toolCallStarts} from './schema/tool-call-starts.js';
import {turnStreamChunks} from './schema/turn-stream-chunks.js';
import {toAgentTurn, turns} from './schema/turns.js';

export interface NewTimelineEntry {
  id: string;
  entryType: string;
  sessionVersion: number;
  sealedEntry: Buffer;
  meta: ConversationItemMeta;
}

export interface TurnEntryPosition {
  turnId: string;
  modelCallIndex: number;
  callIndex?: number | undefined;
}

export async function getConversationById(
  conversationId: string,
): Promise<Conversation | undefined> {
  const rows = await db()
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const row = rows[0];
  return row ? toConversation(row) : undefined;
}

export async function getTurnById(turnId: string): Promise<AgentTurn | undefined> {
  const rows = await db().select().from(turns).where(eq(turns.id, turnId)).limit(1);
  const row = rows[0];
  return row ? toAgentTurn(row) : undefined;
}

async function lockConversation(
  tx: Transaction,
  conversationId: string,
): Promise<Conversation | undefined> {
  const rows = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .for('update');
  const row = rows[0];
  return row ? toConversation(row) : undefined;
}

/**
 * Writes the pinned system entry at `seq` 1. It only lands on a conversation with no assigned
 * `seq`, because pi reads only a leading system message as the base prompt. A conversation that
 * already has entries keeps what it has, so a repeat after a crash writes nothing.
 */
export async function pinSystemEntry(params: {
  conversationId: string;
  entry: NewTimelineEntry;
  /** The content hash of the agent file behind the prompt, or null for the built-in agent alone. */
  agentContentHash: string | null;
}): Promise<'pinned' | 'exists'> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, params.conversationId);
    if (!conversation || conversation.lastSeq > 0) return 'exists';

    await tx.insert(conversationItems).values({
      id: params.entry.id,
      conversationId: params.conversationId,
      seq: 1,
      entryType: params.entry.entryType,
      sessionVersion: params.entry.sessionVersion,
      body: params.entry.sealedEntry,
      meta: params.entry.meta,
    });
    await tx
      .update(conversations)
      .set({lastSeq: 1, agentContentHash: params.agentContentHash})
      .where(eq(conversations.id, params.conversationId));
    return 'pinned';
  });
}

/**
 * Opens a turn for the queued inputs or a requested retry, or returns the running one. Opening
 * claims every queued input in the same transaction, so a turn never exists without something to
 * answer. A retry has nothing to claim: its turn answers what the timeline already holds. Returns
 * undefined when neither is pending and no turn runs.
 */
export async function openTurn(params: {
  conversationId: string;
  model: string | null;
  provider: string | null;
  thinking: string | null;
}): Promise<{turn: AgentTurn; resumed: boolean} | undefined> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, params.conversationId);
    if (!conversation) return undefined;

    const running = await tx
      .select()
      .from(turns)
      .where(and(eq(turns.conversationId, params.conversationId), eq(turns.status, 'running')))
      .limit(1);
    if (running[0]) return {turn: toAgentTurn(running[0]), resumed: true};

    const claimed = await claimQueuedConversationItemsInTransaction(tx, params.conversationId);
    if (claimed === 0 && conversation.retryRequestedAt === null) return undefined;

    const [created] = await tx
      .insert(turns)
      .values({
        conversationId: params.conversationId,
        status: 'running',
        model: params.model,
        provider: params.provider,
        thinking: params.thinking,
      })
      .returning();
    if (!created) throw new Error('Turn insert returned no row');
    // The retry is spent once a turn answers it, so the recovery sweep doesn't start another.
    await tx
      .update(conversations)
      .set({retryRequestedAt: null})
      .where(eq(conversations.id, params.conversationId));
    return {turn: toAgentTurn(created), resumed: false};
  });
}

/** True when an input is queued or a retry is requested, so a turn has something to answer. */
export async function hasPendingTurnWork(conversationId: string): Promise<boolean> {
  const [queued, conversation] = await Promise.all([
    db()
      .select({id: conversationItems.id})
      .from(conversationItems)
      .where(
        and(eq(conversationItems.conversationId, conversationId), isNull(conversationItems.seq)),
      )
      .limit(1),
    getConversationById(conversationId),
  ]);
  return queued.length > 0 || conversation?.retryRequestedAt != null;
}

/**
 * Settles the pending work of a conversation that gets no turn, so the recovery sweep doesn't
 * return to it: queued inputs get their `seq`, a requested retry is spent, and the notice, when
 * there is one, follows the inputs. Does nothing when a turn started in the meantime or nothing
 * is pending, which makes a repeat after a crash write no second notice.
 */
export async function settleWorkWithoutTurn(params: {
  conversationId: string;
  notice?: NewTimelineEntry | undefined;
}): Promise<boolean> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, params.conversationId);
    if (!conversation) return false;

    const running = await tx
      .select({id: turns.id})
      .from(turns)
      .where(and(eq(turns.conversationId, params.conversationId), eq(turns.status, 'running')))
      .limit(1);
    if (running.length > 0) return false;

    const claimed = await claimQueuedConversationItemsInTransaction(tx, params.conversationId);
    if (claimed === 0 && conversation.retryRequestedAt === null) return false;

    const lastSeq = conversation.lastSeq + claimed;
    const {notice} = params;
    if (notice) {
      await tx.insert(conversationItems).values({
        id: notice.id,
        conversationId: params.conversationId,
        seq: lastSeq + 1,
        entryType: notice.entryType,
        sessionVersion: notice.sessionVersion,
        body: notice.sealedEntry,
        meta: notice.meta,
      });
    }
    await tx
      .update(conversations)
      .set({
        lastSeq: notice ? lastSeq + 1 : lastSeq,
        retryRequestedAt: null,
        lastActivityAt: sql`NOW()`,
      })
      .where(eq(conversations.id, params.conversationId));
    return true;
  });
}

/**
 * Gives the queued inputs their `seq` for the next model call of a turn. A requested stop comes
 * first: it claims nothing, so the inputs wait for the turn that follows the stopped one.
 */
export async function claimPendingInputs(params: {
  conversationId: string;
  turnId: string;
}): Promise<{claimed: number; stopRequested: boolean}> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, params.conversationId);
    if (!conversation) return {claimed: 0, stopRequested: false};

    const turn = await tx
      .select({stopRequestedAt: turns.stopRequestedAt})
      .from(turns)
      .where(eq(turns.id, params.turnId))
      .limit(1);
    if (turn[0]?.stopRequestedAt) return {claimed: 0, stopRequested: true};

    const claimed = await claimQueuedConversationItemsInTransaction(tx, params.conversationId);
    return {claimed, stopRequested: false};
  });
}

/** Asks the running turn of a conversation to stop. False when no turn runs or it was asked already. */
export async function requestTurnStop(conversationId: string): Promise<boolean> {
  const rows = await db()
    .update(turns)
    .set({stopRequestedAt: sql`NOW()`})
    .where(
      and(
        eq(turns.conversationId, conversationId),
        eq(turns.status, 'running'),
        isNull(turns.stopRequestedAt),
      ),
    )
    .returning({id: turns.id});
  return rows.length > 0;
}

export async function isTurnStopRequested(turnId: string): Promise<boolean> {
  const rows = await db()
    .select({stopRequestedAt: turns.stopRequestedAt})
    .from(turns)
    .where(eq(turns.id, turnId))
    .limit(1);
  return rows[0]?.stopRequestedAt != null;
}

/**
 * Requests a retry when the latest turn failed or was denied. A denied turn has no row, only a
 * notice, so the notice and the latest turn are compared by time. A running turn refuses.
 */
export async function requestRetry(
  conversationId: string,
): Promise<'requested' | 'turn-running' | 'not-retryable' | 'not-found'> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, conversationId);
    if (!conversation) return 'not-found';

    const [latestTurn] = await tx
      .select()
      .from(turns)
      .where(eq(turns.conversationId, conversationId))
      .orderBy(desc(turns.id))
      .limit(1);
    if (latestTurn?.status === 'running') return 'turn-running';

    const [latestNotice] = await tx
      .select({createdAt: conversationItems.createdAt})
      .from(conversationItems)
      .where(
        and(
          eq(conversationItems.conversationId, conversationId),
          eq(conversationItems.entryType, 'custom'),
          sql`${conversationItems.meta}->>'custom_type' = ${TURN_NOTICE_CUSTOM_TYPE}`,
        ),
      )
      .orderBy(desc(conversationItems.id))
      .limit(1);

    const failed = latestTurn?.status === 'failed';
    const denied =
      latestNotice !== undefined &&
      (latestTurn === undefined || latestNotice.createdAt > latestTurn.startedAt);
    if (!failed && !denied) return 'not-retryable';

    await tx
      .update(conversations)
      .set({retryRequestedAt: sql`COALESCE(${conversations.retryRequestedAt}, NOW())`})
      .where(eq(conversations.id, conversationId));
    return 'requested';
  });
}

/**
 * Conversations with an input queued or a retry requested and no running turn, oldest activity
 * first. These are the ones a lost wake leaves behind.
 */
export async function listConversationsToRecover(limit: number): Promise<string[]> {
  const queued = db()
    .select({id: conversationItems.conversationId})
    .from(conversationItems)
    .where(isNull(conversationItems.seq));
  const rows = await db()
    .select({id: conversations.id})
    .from(conversations)
    .where(
      and(
        or(isNotNull(conversations.retryRequestedAt), inArray(conversations.id, queued)),
        notExists(
          db()
            .select({id: turns.id})
            .from(turns)
            .where(and(eq(turns.conversationId, conversations.id), eq(turns.status, 'running'))),
        ),
      ),
    )
    .orderBy(asc(conversations.lastActivityAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/**
 * Moves a running turn to its final state. A turn that already finished stays as it is. A notice
 * lands in the same transaction, so a crash can't leave a finished turn without it.
 */
export async function finishTurnRow(params: {
  conversationId: string;
  turnId: string;
  status: Exclude<AgentTurn['status'], 'running'>;
  failureCode?: string | undefined;
  notice?: NewTimelineEntry | undefined;
}): Promise<AgentTurn | undefined> {
  return await db().transaction(async (tx) => {
    // Every writer takes the conversation lock before it touches a turn.
    const conversation = await lockConversation(tx, params.conversationId);
    const [row] = await tx
      .update(turns)
      .set({
        status: params.status,
        failureCode: params.failureCode ?? null,
        finishedAt: sql`NOW()`,
      })
      .where(and(eq(turns.id, params.turnId), eq(turns.status, 'running')))
      .returning();
    if (!row) return undefined;
    // A failed call leaves its partial text behind. Nothing reads it once the turn is over.
    await tx.delete(turnStreamChunks).where(eq(turnStreamChunks.turnId, params.turnId));
    if (params.notice && conversation) {
      const seq = conversation.lastSeq + 1;
      await tx.insert(conversationItems).values({
        id: params.notice.id,
        conversationId: params.conversationId,
        seq,
        entryType: params.notice.entryType,
        sessionVersion: params.notice.sessionVersion,
        turnId: params.turnId,
        body: params.notice.sealedEntry,
        meta: params.notice.meta,
      });
      await advanceConversation(tx, {conversationId: params.conversationId, seq});
    }
    return toAgentTurn(row);
  });
}

/**
 * Notes that a reply could not be delivered, and puts the notice that says so on the timeline.
 * The reply and the notice are settled together, so a repeat writes neither again, and the notice
 * is never taken for a denial that still needs telling.
 */
export async function settleUndeliverableReply(params: {
  replyId: string;
  conversationId: string;
  notice: NewTimelineEntry;
}): Promise<boolean> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, params.conversationId);
    if (!conversation) return false;

    const [recorded] = await tx
      .insert(replyDeliveries)
      .values({
        replyId: params.replyId,
        conversationId: params.conversationId,
        outcome: 'undeliverable',
      })
      .onConflictDoNothing()
      .returning({replyId: replyDeliveries.replyId});
    if (!recorded) return false;

    const seq = conversation.lastSeq + 1;
    await tx.insert(conversationItems).values({
      id: params.notice.id,
      conversationId: params.conversationId,
      seq,
      entryType: params.notice.entryType,
      sessionVersion: params.notice.sessionVersion,
      body: params.notice.sealedEntry,
      meta: params.notice.meta,
    });
    await tx.insert(replyDeliveries).values({
      replyId: params.notice.id,
      conversationId: params.conversationId,
      outcome: 'skipped',
    });
    await advanceConversation(tx, {conversationId: params.conversationId, seq});
    return true;
  });
}

/** The entries a prompt is built from, oldest first, starting at `context_start_seq`. */
export async function listContextItems(params: {
  conversationId: string;
  fromSeq: number;
}): Promise<ConversationItem[]> {
  const rows = await db()
    .select()
    .from(conversationItems)
    .where(
      and(
        eq(conversationItems.conversationId, params.conversationId),
        isNotNull(conversationItems.seq),
        gte(conversationItems.seq, params.fromSeq),
      ),
    )
    .orderBy(asc(conversationItems.seq));
  return rows.map(toConversationItem);
}

async function findTurnEntry(
  executor: Pick<Transaction, 'select'>,
  position: TurnEntryPosition,
): Promise<ConversationItem | undefined> {
  const rows = await executor
    .select()
    .from(conversationItems)
    .where(
      and(
        eq(conversationItems.turnId, position.turnId),
        eq(conversationItems.modelCallIndex, position.modelCallIndex),
        position.callIndex === undefined
          ? isNull(conversationItems.callIndex)
          : eq(conversationItems.callIndex, position.callIndex),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toConversationItem(row) : undefined;
}

export async function getTurnEntry(
  position: TurnEntryPosition,
): Promise<ConversationItem | undefined> {
  return await findTurnEntry(db(), position);
}

/** A call that outlives its turn, such as one that timed out, must not add to the timeline. */
async function isTurnRunning(tx: Transaction, turnId: string): Promise<boolean> {
  const running = await tx
    .select({id: turns.id})
    .from(turns)
    .where(and(eq(turns.id, turnId), eq(turns.status, 'running')))
    .limit(1);
  return running.length > 0;
}

async function advanceConversation(
  tx: Transaction,
  params: {
    conversationId: string;
    seq: number;
    lastAgentSeq?: number | undefined;
    contextStartSeq?: number | undefined;
  },
): Promise<void> {
  await tx
    .update(conversations)
    .set({
      lastSeq: params.seq,
      lastActivityAt: sql`NOW()`,
      ...(params.lastAgentSeq === undefined ? {} : {lastAgentSeq: params.lastAgentSeq}),
      ...(params.contextStartSeq === undefined ? {} : {contextStartSeq: params.contextStartSeq}),
    })
    .where(eq(conversations.id, params.conversationId));
}

/** A stored reply ends its model call: the call's chunks go and the turn counts the call. */
async function completeModelCall(tx: Transaction, position: TurnEntryPosition): Promise<void> {
  await tx
    .delete(turnStreamChunks)
    .where(
      and(
        eq(turnStreamChunks.turnId, position.turnId),
        eq(turnStreamChunks.modelCallIndex, position.modelCallIndex),
      ),
    );
  await tx
    .update(turns)
    .set({modelCallCount: sql`${turns.modelCallCount} + 1`})
    .where(eq(turns.id, position.turnId));
}

/** The `seq` of the first entry a compaction keeps, which becomes the start of the prompt. */
async function keptEntrySeq(
  tx: Transaction,
  params: {conversationId: string; itemId: string},
): Promise<number> {
  const [kept] = await tx
    .select({seq: conversationItems.seq})
    .from(conversationItems)
    .where(
      and(
        eq(conversationItems.id, params.itemId),
        eq(conversationItems.conversationId, params.conversationId),
      ),
    )
    .limit(1);
  if (kept?.seq == null) {
    throw new Error('The first kept entry of a compaction is not on the timeline');
  }
  return kept.seq;
}

/**
 * Appends an entry the turn produced. It gets its `seq` here, under the conversation row lock,
 * so it lands after everything already claimed. A repeat at the same position returns the stored
 * entry and writes nothing, which makes a retry after a crash safe.
 */
export async function appendTurnEntry(params: {
  conversationId: string;
  position: TurnEntryPosition;
  entry: NewTimelineEntry;
  /** An assistant reply ends a model call: it clears the call's chunks and counts the call. */
  completesModelCall: boolean;
  /** A compaction moves the start of the prompt to the first entry it keeps. */
  startContextAtItemId?: string | undefined;
}): Promise<{item: ConversationItem; stored: boolean} | undefined> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, params.conversationId);
    if (!conversation) throw new Error(`Conversation ${params.conversationId} no longer exists`);

    const {position} = params;
    // A call that outlives its turn, such as one that timed out, must not add to the timeline.
    if (!(await isTurnRunning(tx, position.turnId))) return undefined;

    const existing = await findTurnEntry(tx, position);
    if (existing) return {item: existing, stored: false};

    const seq = conversation.lastSeq + 1;
    const [inserted] = await tx
      .insert(conversationItems)
      .values({
        id: params.entry.id,
        conversationId: params.conversationId,
        seq,
        entryType: params.entry.entryType,
        sessionVersion: params.entry.sessionVersion,
        turnId: position.turnId,
        modelCallIndex: position.modelCallIndex,
        callIndex: position.callIndex ?? null,
        body: params.entry.sealedEntry,
        meta: params.entry.meta,
      })
      .returning();
    if (!inserted) throw new Error('Turn entry insert returned no row');

    const contextStartSeq =
      params.startContextAtItemId === undefined
        ? undefined
        : await keptEntrySeq(tx, {
            conversationId: params.conversationId,
            itemId: params.startContextAtItemId,
          });
    await advanceConversation(tx, {
      conversationId: params.conversationId,
      seq,
      lastAgentSeq: params.completesModelCall ? seq : undefined,
      contextStartSeq,
    });
    if (params.completesModelCall) await completeModelCall(tx, position);
    return {item: toConversationItem(inserted), stored: true};
  });
}

export async function insertStreamChunk(params: {
  turnId: string;
  modelCallIndex: number;
  chunkSeq: number;
  sealedChunk: Buffer;
}): Promise<void> {
  await db()
    .insert(turnStreamChunks)
    .values({
      turnId: params.turnId,
      modelCallIndex: params.modelCallIndex,
      chunkSeq: params.chunkSeq,
      body: params.sealedChunk,
    })
    .onConflictDoNothing();
}

/** A retried model call starts its stream over, so partial text from the failed attempt goes. */
export async function deleteStreamChunks(params: {
  turnId: string;
  modelCallIndex: number;
}): Promise<void> {
  await db()
    .delete(turnStreamChunks)
    .where(
      and(
        eq(turnStreamChunks.turnId, params.turnId),
        eq(turnStreamChunks.modelCallIndex, params.modelCallIndex),
      ),
    );
}

/**
 * Records that a write tool call has begun, and says whether this attempt may run it. Only the
 * first attempt for a position gets true. A later one finds the row, so a crash after the call
 * began never runs it again.
 */
export async function claimToolCallStart(position: {
  turnId: string;
  modelCallIndex: number;
  callIndex: number;
}): Promise<boolean> {
  const inserted = await db()
    .insert(toolCallStarts)
    .values(position)
    .onConflictDoNothing()
    .returning({turnId: toolCallStarts.turnId});
  return inserted.length > 0;
}
