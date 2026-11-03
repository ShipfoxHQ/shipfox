import type {Buffer} from 'node:buffer';
import {
  paginateTimestampIdRows,
  type TimestampIdCursor,
  timestampIdCursorColumn,
  timestampIdCursorWhere,
} from '@shipfox/node-drizzle';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  isNotNull,
  isNull,
  lt,
  type SQL,
  sql,
} from 'drizzle-orm';
import type {
  AgentTurn,
  Conversation,
  ConversationItem,
  ConversationItemMeta,
} from '#core/entities/conversation.js';
import {db, type Transaction} from './db.js';
import {conversationItems, toConversationItem} from './schema/conversation-items.js';
import {conversations, toConversation} from './schema/conversations.js';
import {turnStreamChunks} from './schema/turn-stream-chunks.js';
import {toAgentTurn, turns} from './schema/turns.js';

export interface NewConversationInput {
  id: string;
  clientMessageId: string;
  sessionVersion: number;
  sealedEntry: Buffer;
  meta: ConversationItemMeta;
}

export interface InsertWebConversationParams {
  id: string;
  workspaceId: string;
  projectId: string;
  agentKey: string;
  ownerUserId: string;
  sealedTitle: Buffer;
  firstInput: NewConversationInput;
}

export interface InsertIntegrationConversationParams {
  id: string;
  workspaceId: string;
  projectId: string;
  agentKey: string;
  origin: {connectionId: string; provider: string; key: string};
  firstInput: NewConversationInput;
}

export interface ListWebConversationsParams {
  projectId: string;
  ownerUserId: string;
  limit: number;
  cursor?: TimestampIdCursor | undefined;
}

export interface ListWebConversationsResult {
  conversations: Conversation[];
  nextCursor: TimestampIdCursor | null;
  unreadCount: number;
}

export interface ListConversationTimelineParams {
  conversationId: string;
  afterSeq?: number | undefined;
  beforeSeq?: number | undefined;
  limit: number;
  queuedLimit: number;
}

export interface ConversationTimeline {
  items: ConversationItem[];
  hasMore: boolean;
  queued: ConversationItem[];
  queuedHasMore: boolean;
}

// Sealing binds a body to its row, so a row's ID has to exist before its insert.
export async function newConversationRecordId(): Promise<string> {
  const result = await db().execute<{id: string}>(sql`SELECT uuidv7() AS id`);
  const row = result.rows[0];
  if (!row) throw new Error('uuidv7() returned no row');
  return row.id;
}

/** The only predicate that grants access to a conversation. */
function ownedWebConversation(userId: string): SQL | undefined {
  return and(eq(conversations.originKind, 'web'), eq(conversations.ownerUserId, userId));
}

export async function loadWebConversation(params: {
  conversationId: string;
  userId: string;
}): Promise<Conversation | undefined> {
  const rows = await db()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, params.conversationId), ownedWebConversation(params.userId)))
    .limit(1);
  const row = rows[0];
  return row ? toConversation(row) : undefined;
}

export async function findIntegrationConversation(params: {
  connectionId: string;
  key: string;
}): Promise<Conversation | undefined> {
  const rows = await db()
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.originKind, 'integration'),
        eq(conversations.originConnectionId, params.connectionId),
        eq(conversations.originKey, params.key),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toConversation(row) : undefined;
}

export async function listWebConversations(
  params: ListWebConversationsParams,
): Promise<ListWebConversationsResult> {
  const scope = and(
    eq(conversations.projectId, params.projectId),
    ownedWebConversation(params.ownerUserId),
  );
  const [rows, unreadRows] = await Promise.all([
    db()
      .select({
        ...getTableColumns(conversations),
        cursorLastActivityAt: timestampIdCursorColumn(conversations.lastActivityAt),
      })
      .from(conversations)
      .where(
        and(
          scope,
          timestampIdCursorWhere({
            timestampColumn: conversations.lastActivityAt,
            idColumn: conversations.id,
            cursor: params.cursor,
          }),
        ),
      )
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
      .limit(params.limit + 1),
    db()
      .select({count: sql<number>`count(*)::int`})
      .from(conversations)
      .where(and(scope, gt(conversations.lastAgentSeq, conversations.lastReadSeq))),
  ]);

  const {pageRows, nextCursor} = paginateTimestampIdRows({
    rows,
    limit: params.limit,
    timestampKey: 'lastActivityAt',
    cursorTimestamp: (row) => row.cursorLastActivityAt,
  });

  return {
    conversations: pageRows.map(toConversation),
    nextCursor,
    unreadCount: unreadRows[0]?.count ?? 0,
  };
}

/**
 * Inserts a conversation with its first input. A repeated `clientMessageId` for
 * the same project and owner returns the stored conversation instead, so a
 * network retry can't open a second one.
 */
export async function insertWebConversation(
  params: InsertWebConversationParams,
): Promise<{conversation: Conversation; item: ConversationItem}> {
  return await db().transaction(async (tx) => {
    const {firstInput} = params;
    const inserted = await tx
      .insert(conversations)
      .values({
        id: params.id,
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        agentKey: params.agentKey,
        originKind: 'web',
        ownerUserId: params.ownerUserId,
        clientMessageId: firstInput.clientMessageId,
        title: params.sealedTitle,
      })
      .onConflictDoNothing({
        target: [conversations.projectId, conversations.ownerUserId, conversations.clientMessageId],
        where: sql`"client_message_id" IS NOT NULL`,
      })
      .returning();
    const conversation =
      inserted[0] ??
      (
        await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.projectId, params.projectId),
              eq(conversations.clientMessageId, firstInput.clientMessageId),
              ownedWebConversation(params.ownerUserId),
            ),
          )
          .limit(1)
      )[0];
    if (!conversation) throw new Error('Conversation insert returned no row');

    const firstItem = inserted[0]
      ? await tx
          .insert(conversationItems)
          .values({
            id: firstInput.id,
            conversationId: conversation.id,
            entryType: 'message',
            sessionVersion: firstInput.sessionVersion,
            authorUserId: params.ownerUserId,
            clientMessageId: firstInput.clientMessageId,
            body: firstInput.sealedEntry,
            meta: firstInput.meta,
          })
          .returning()
      : await tx
          .select()
          .from(conversationItems)
          .where(
            and(
              eq(conversationItems.conversationId, conversation.id),
              eq(conversationItems.clientMessageId, firstInput.clientMessageId),
            ),
          )
          .limit(1);
    const [item] = firstItem;
    if (!item) throw new Error('Conversation insert returned no item');
    return {conversation: toConversation(conversation), item: toConversationItem(item)};
  });
}

/**
 * Inserts an integration conversation with its first input, or finds the one that already owns
 * the key. Only the call that inserted the conversation writes the first input, and it is the
 * only one that sees `created`. A replay finds its own conversation by `clientMessageId`.
 */
export async function insertIntegrationConversation(
  params: InsertIntegrationConversationParams,
): Promise<{conversation: Conversation; created: boolean}> {
  return await db().transaction(async (tx) => {
    const {firstInput, origin} = params;
    const inserted = await tx
      .insert(conversations)
      .values({
        id: params.id,
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        agentKey: params.agentKey,
        originKind: 'integration',
        originConnectionId: origin.connectionId,
        originProvider: origin.provider,
        originKey: origin.key,
        clientMessageId: firstInput.clientMessageId,
      })
      .onConflictDoNothing({target: [conversations.originConnectionId, conversations.originKey]})
      .returning();
    const [created] = inserted;
    if (!created) {
      const [existing] = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.originConnectionId, origin.connectionId),
            eq(conversations.originKey, origin.key),
          ),
        )
        .limit(1);
      if (!existing) throw new Error('Conversation insert returned no row');
      return {conversation: toConversation(existing), created: false};
    }

    await tx.insert(conversationItems).values({
      id: firstInput.id,
      conversationId: created.id,
      entryType: 'message',
      sessionVersion: firstInput.sessionVersion,
      authorUserId: null,
      clientMessageId: firstInput.clientMessageId,
      body: firstInput.sealedEntry,
      meta: firstInput.meta,
    });
    return {conversation: toConversation(created), created: true};
  });
}

/**
 * Queues a user message with a null `seq`. A repeated `clientMessageId` returns
 * the stored item instead, so a network retry can't queue a second input.
 * Returns undefined when the conversation no longer exists. A message from a person starts the
 * run budget over, and `authorUserId` is null when the person isn't a Shipfox user.
 */
export async function insertQueuedUserMessage(
  params: NewConversationInput & {
    conversationId: string;
    authorUserId: string | null;
    resetRunBudget?: boolean | undefined;
  },
): Promise<ConversationItem | undefined> {
  return await db().transaction(async (tx) => {
    // The row lock serializes this with delete and with a concurrent repeat of the same post.
    const locked = await tx
      .select({id: conversations.id})
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .for('update');
    if (locked.length === 0) return undefined;

    const inserted = await tx
      .insert(conversationItems)
      .values({
        id: params.id,
        conversationId: params.conversationId,
        entryType: 'message',
        sessionVersion: params.sessionVersion,
        authorUserId: params.authorUserId,
        clientMessageId: params.clientMessageId,
        body: params.sealedEntry,
        meta: params.meta,
      })
      .onConflictDoNothing({
        target: [conversationItems.conversationId, conversationItems.clientMessageId],
        where: sql`"client_message_id" IS NOT NULL`,
      })
      .returning();
    const [created] = inserted;
    if (created) {
      await tx
        .update(conversations)
        .set({
          lastActivityAt: sql`NOW()`,
          ...(params.resetRunBudget ? {runStartsSinceHuman: 0} : {}),
        })
        .where(eq(conversations.id, params.conversationId));
      return toConversationItem(created);
    }

    const stored = await tx
      .select()
      .from(conversationItems)
      .where(
        and(
          eq(conversationItems.conversationId, params.conversationId),
          eq(conversationItems.clientMessageId, params.clientMessageId),
        ),
      )
      .limit(1);
    const [existing] = stored;
    if (!existing) throw new Error('Conversation message insert returned no row');
    return toConversationItem(existing);
  });
}

/**
 * Assigns the next `seq` values to every queued item, oldest first, under the
 * conversation row lock. Returns how many items it claimed.
 */
export async function claimQueuedConversationItems(conversationId: string): Promise<number> {
  return await db().transaction(async (tx) => {
    const locked = await tx
      .select({id: conversations.id})
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update');
    if (locked.length === 0) return 0;
    return await claimQueuedConversationItemsInTransaction(tx, conversationId);
  });
}

/** The claim as a step of a larger transaction. The caller must hold the conversation row lock. */
export async function claimQueuedConversationItemsInTransaction(
  tx: Transaction,
  conversationId: string,
): Promise<number> {
  const conversation = (
    await tx
      .select({lastSeq: conversations.lastSeq})
      .from(conversations)
      .where(eq(conversations.id, conversationId))
  )[0];
  if (!conversation) return 0;

  const queued = await tx
    .select({id: conversationItems.id})
    .from(conversationItems)
    .where(and(eq(conversationItems.conversationId, conversationId), isNull(conversationItems.seq)))
    .orderBy(asc(conversationItems.id));
  if (queued.length === 0) return 0;

  for (const [index, item] of queued.entries()) {
    await tx
      .update(conversationItems)
      .set({seq: conversation.lastSeq + index + 1})
      .where(eq(conversationItems.id, item.id));
  }
  await tx
    .update(conversations)
    .set({lastSeq: conversation.lastSeq + queued.length})
    .where(eq(conversations.id, conversationId));
  return queued.length;
}

async function readTimeline(
  tx: Transaction,
  params: ListConversationTimelineParams,
): Promise<ConversationTimeline> {
  const readsForward = params.afterSeq !== undefined;
  const inConversation = eq(conversationItems.conversationId, params.conversationId);

  const claimedRows = await tx
    .select()
    .from(conversationItems)
    .where(
      and(
        inConversation,
        isNotNull(conversationItems.seq),
        // In the page query, so a hidden entry can't leave a page with no cursor to follow.
        sql`${conversationItems.meta}->>'role' IS DISTINCT FROM 'system'`,
        params.afterSeq === undefined ? undefined : gt(conversationItems.seq, params.afterSeq),
        params.beforeSeq === undefined ? undefined : lt(conversationItems.seq, params.beforeSeq),
      ),
    )
    .orderBy(readsForward ? asc(conversationItems.seq) : desc(conversationItems.seq))
    .limit(params.limit + 1);
  const queuedRows = await tx
    .select()
    .from(conversationItems)
    .where(and(inConversation, isNull(conversationItems.seq)))
    .orderBy(asc(conversationItems.id))
    .limit(params.queuedLimit + 1);

  const page = claimedRows.slice(0, params.limit);
  if (!readsForward) page.reverse();
  return {
    items: page.map(toConversationItem),
    hasMore: claimedRows.length > params.limit,
    queued: queuedRows.slice(0, params.queuedLimit).map(toConversationItem),
    queuedHasMore: queuedRows.length > params.queuedLimit,
  };
}

/**
 * Reads claimed items in ascending `seq` order, after a `seq`, before one, or
 * the latest page when neither is set, with the queued inputs. System entries
 * stay out, so the pinned prompt and tool names never reach a client. One snapshot
 * covers both reads, so a claim can't hide an item from them or show it twice.
 */
export async function listConversationTimeline(
  params: ListConversationTimelineParams,
): Promise<ConversationTimeline> {
  return await db().transaction((tx) => readTimeline(tx, params), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

export interface StreamChunkCursor {
  turnId: string;
  modelCallIndex: number;
  chunkSeq: number;
}

export interface StreamChunk {
  modelCallIndex: number;
  chunkSeq: number;
  sealedChunk: Buffer;
}

export interface ReadConversationStreamParams {
  conversationId: string;
  afterSeq: number;
  /** The last chunk the reader holds. The read starts at it, so the reader can check it is intact. */
  chunkCursor?: StreamChunkCursor | undefined;
  limit: number;
  queuedLimit: number;
}

export interface ConversationStreamSnapshot extends ConversationTimeline {
  /** False once the conversation is deleted. */
  exists: boolean;
  /** The latest turn, running or not. */
  turn: AgentTurn | undefined;
  /** Chunks of the turn when it is running, in write order. */
  chunks: StreamChunk[];
}

const STREAM_CHUNKS_PER_READ = 500;

/**
 * One tick of a stream. A single snapshot covers the turn, its chunks, and the timeline, because
 * the commit that stores a reply also deletes its chunks. Reading them apart could show a reader
 * a reply without its chunks, which looks like a retry.
 */
export async function readConversationStream(
  params: ReadConversationStreamParams,
): Promise<ConversationStreamSnapshot> {
  return await db().transaction(
    async (tx) => {
      const existing = await tx
        .select({id: conversations.id})
        .from(conversations)
        .where(eq(conversations.id, params.conversationId))
        .limit(1);
      const latestTurns = await tx
        .select()
        .from(turns)
        .where(eq(turns.conversationId, params.conversationId))
        .orderBy(desc(turns.startedAt), desc(turns.id))
        .limit(1);
      const turn = latestTurns[0] ? toAgentTurn(latestTurns[0]) : undefined;
      const timeline = await readTimeline(tx, {
        conversationId: params.conversationId,
        afterSeq: params.afterSeq,
        limit: params.limit,
        queuedLimit: params.queuedLimit,
      });
      const chunks =
        turn?.status === 'running' ? await readChunks(tx, turn.id, params.chunkCursor) : [];
      return {exists: existing.length > 0, turn, chunks, ...timeline};
    },
    {isolationLevel: 'repeatable read', accessMode: 'read only'},
  );
}

async function readChunks(
  tx: Transaction,
  turnId: string,
  chunkCursor?: StreamChunkCursor | undefined,
): Promise<StreamChunk[]> {
  const cursor = chunkCursor?.turnId === turnId ? chunkCursor : undefined;
  const rows = await tx
    .select()
    .from(turnStreamChunks)
    .where(
      and(
        eq(turnStreamChunks.turnId, turnId),
        cursor
          ? sql`(${turnStreamChunks.modelCallIndex}, ${turnStreamChunks.chunkSeq}) >= (${cursor.modelCallIndex}, ${cursor.chunkSeq})`
          : undefined,
      ),
    )
    .orderBy(asc(turnStreamChunks.modelCallIndex), asc(turnStreamChunks.chunkSeq))
    .limit(STREAM_CHUNKS_PER_READ);
  return rows.map((row) => ({
    modelCallIndex: row.modelCallIndex,
    chunkSeq: row.chunkSeq,
    sealedChunk: row.body,
  }));
}

/** The running turn's chunks from the first one, for a reader that must start over. */
export async function listStreamChunks(turnId: string): Promise<StreamChunk[]> {
  return await db().transaction((tx) => readChunks(tx, turnId));
}

export async function getRunningTurn(conversationId: string): Promise<AgentTurn | undefined> {
  const rows = await db()
    .select()
    .from(turns)
    .where(and(eq(turns.conversationId, conversationId), eq(turns.status, 'running')))
    .limit(1);
  const row = rows[0];
  return row ? toAgentTurn(row) : undefined;
}

export async function getLatestTurn(conversationId: string): Promise<AgentTurn | undefined> {
  const rows = await db()
    .select()
    .from(turns)
    .where(eq(turns.conversationId, conversationId))
    .orderBy(desc(turns.startedAt), desc(turns.id))
    .limit(1);
  const row = rows[0];
  return row ? toAgentTurn(row) : undefined;
}

/** Only moves forward, and never past an item the conversation already has. */
export async function markConversationRead(params: {
  conversationId: string;
  lastReadSeq: number;
}): Promise<void> {
  await db()
    .update(conversations)
    .set({
      lastReadSeq: sql`GREATEST(${conversations.lastReadSeq}, LEAST(${params.lastReadSeq}::integer, ${conversations.lastSeq}))`,
    })
    .where(eq(conversations.id, params.conversationId));
}

/**
 * Deletes a conversation and its timeline unless a turn is running. The row lock
 * makes this safe against a turn that starts at the same moment.
 */
export async function deleteConversationUnlessTurnRunning(
  conversationId: string,
): Promise<'deleted' | 'not-found' | 'turn-running'> {
  return await db().transaction(async (tx) => {
    const locked = await tx
      .select({id: conversations.id})
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update');
    if (locked.length === 0) return 'not-found';

    const running = await tx
      .select({id: turns.id})
      .from(turns)
      .where(and(eq(turns.conversationId, conversationId), eq(turns.status, 'running')))
      .limit(1);
    if (running.length > 0) return 'turn-running';

    await tx.delete(conversations).where(eq(conversations.id, conversationId));
    return 'deleted';
  });
}

/**
 * Spends one run start from the conversation's budget. It returns false once the budget is used,
 * and when the conversation is gone or belongs to another workspace.
 */
export async function claimConversationRunStart(params: {
  conversationId: string;
  workspaceId: string;
  limit: number;
}): Promise<boolean> {
  const claimed = await db()
    .update(conversations)
    .set({runStartsSinceHuman: sql`${conversations.runStartsSinceHuman} + 1`})
    .where(
      and(
        eq(conversations.id, params.conversationId),
        eq(conversations.workspaceId, params.workspaceId),
        lt(conversations.runStartsSinceHuman, params.limit),
      ),
    )
    .returning({id: conversations.id});
  return claimed.length > 0;
}
