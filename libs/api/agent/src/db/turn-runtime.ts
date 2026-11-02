import type {Buffer} from 'node:buffer';
import {and, asc, eq, gte, isNotNull, isNull, sql} from 'drizzle-orm';
import type {
  AgentTurn,
  Conversation,
  ConversationItem,
  ConversationItemMeta,
} from '#core/entities/conversation.js';
import {claimQueuedConversationItemsInTransaction} from './conversations.js';
import {db, type Transaction} from './db.js';
import {conversationItems, toConversationItem} from './schema/conversation-items.js';
import {conversations, toConversation} from './schema/conversations.js';
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
      .set({lastSeq: 1})
      .where(eq(conversations.id, params.conversationId));
    return 'pinned';
  });
}

/**
 * Opens a turn for the queued inputs, or returns the running one. Opening claims every queued
 * input in the same transaction, so a turn never exists without something to answer. Returns
 * undefined when nothing is queued and no turn runs.
 */
export async function openTurn(params: {
  conversationId: string;
  model: string;
  provider: string;
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
    if (claimed === 0) return undefined;

    const [created] = await tx
      .insert(turns)
      .values({
        conversationId: params.conversationId,
        status: 'running',
        model: params.model,
        provider: params.provider,
      })
      .returning();
    if (!created) throw new Error('Turn insert returned no row');
    return {turn: toAgentTurn(created), resumed: false};
  });
}

export async function claimPendingInputs(conversationId: string): Promise<number> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, conversationId);
    if (!conversation) return 0;
    return await claimQueuedConversationItemsInTransaction(tx, conversationId);
  });
}

/** Moves a running turn to its final state. A turn that already finished stays as it is. */
export async function finishTurnRow(params: {
  turnId: string;
  status: Exclude<AgentTurn['status'], 'running'>;
  failureCode?: string | undefined;
}): Promise<AgentTurn | undefined> {
  const [row] = await db()
    .update(turns)
    .set({
      status: params.status,
      failureCode: params.failureCode ?? null,
      finishedAt: sql`NOW()`,
    })
    .where(and(eq(turns.id, params.turnId), eq(turns.status, 'running')))
    .returning();
  return row ? toAgentTurn(row) : undefined;
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

export async function getTurnEntry(
  position: TurnEntryPosition,
): Promise<ConversationItem | undefined> {
  const rows = await db()
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

export async function hasQueuedInputs(conversationId: string): Promise<boolean> {
  const rows = await db()
    .select({id: conversationItems.id})
    .from(conversationItems)
    .where(and(eq(conversationItems.conversationId, conversationId), isNull(conversationItems.seq)))
    .limit(1);
  return rows.length > 0;
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
}): Promise<{item: ConversationItem; stored: boolean}> {
  return await db().transaction(async (tx) => {
    const conversation = await lockConversation(tx, params.conversationId);
    if (!conversation) throw new Error(`Conversation ${params.conversationId} no longer exists`);

    const {position} = params;
    const existing = await tx
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
    if (existing[0]) return {item: toConversationItem(existing[0]), stored: false};

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

    await tx
      .update(conversations)
      .set({
        lastSeq: seq,
        lastActivityAt: sql`NOW()`,
        ...(params.completesModelCall ? {lastAgentSeq: seq} : {}),
      })
      .where(eq(conversations.id, params.conversationId));
    if (params.completesModelCall) {
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

export async function isStopRequested(turnId: string): Promise<boolean> {
  const rows = await db()
    .select({stopRequestedAt: turns.stopRequestedAt})
    .from(turns)
    .where(eq(turns.id, turnId))
    .limit(1);
  return rows[0]?.stopRequestedAt != null;
}
