import type {Buffer} from 'node:buffer';
import type {ConversationItemMetaDto} from '@shipfox/api-agent-dto';
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
import type {AgentTurn, Conversation, ConversationItem} from '#core/entities/conversation.js';
import {db} from './db.js';
import {conversationItems, toConversationItem} from './schema/conversation-items.js';
import {conversations, toConversation} from './schema/conversations.js';
import {toAgentTurn, turns} from './schema/turns.js';

export interface NewConversationInput {
  id: string;
  clientMessageId: string;
  sealedBody: Buffer;
  meta: ConversationItemMetaDto;
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
            kind: 'user_message',
            authorUserId: params.ownerUserId,
            clientMessageId: firstInput.clientMessageId,
            body: firstInput.sealedBody,
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
 * Queues a user message with a null `seq`. A repeated `clientMessageId` returns
 * the stored item instead, so a network retry can't queue a second input.
 * Returns undefined when the conversation no longer exists.
 */
export async function insertQueuedUserMessage(
  params: NewConversationInput & {conversationId: string; authorUserId: string},
): Promise<ConversationItem | undefined> {
  return await db().transaction(async (tx) => {
    // The row lock serializes this with delete and with a concurrent repeat of the same post.
    const touched = await tx
      .update(conversations)
      .set({lastActivityAt: sql`NOW()`})
      .where(eq(conversations.id, params.conversationId))
      .returning({id: conversations.id});
    if (touched.length === 0) return undefined;

    const inserted = await tx
      .insert(conversationItems)
      .values({
        id: params.id,
        conversationId: params.conversationId,
        kind: 'user_message',
        authorUserId: params.authorUserId,
        clientMessageId: params.clientMessageId,
        body: params.sealedBody,
        meta: params.meta,
      })
      .onConflictDoNothing({
        target: [conversationItems.conversationId, conversationItems.clientMessageId],
        where: sql`"client_message_id" IS NOT NULL`,
      })
      .returning();
    const existing =
      inserted[0] ??
      (
        await tx
          .select()
          .from(conversationItems)
          .where(
            and(
              eq(conversationItems.conversationId, params.conversationId),
              eq(conversationItems.clientMessageId, params.clientMessageId),
            ),
          )
          .limit(1)
      )[0];
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
      .select({lastSeq: conversations.lastSeq})
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update');
    const conversation = locked[0];
    if (!conversation) return 0;

    const queued = await tx
      .select({id: conversationItems.id})
      .from(conversationItems)
      .where(
        and(eq(conversationItems.conversationId, conversationId), isNull(conversationItems.seq)),
      )
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
  });
}

/**
 * Reads claimed items in ascending `seq` order, after a `seq`, before one, or
 * the latest page when neither is set, with the queued inputs. One snapshot
 * covers both reads, so a claim can't hide an item from them or show it twice.
 */
export async function listConversationTimeline(
  params: ListConversationTimelineParams,
): Promise<ConversationTimeline> {
  const readsForward = params.afterSeq !== undefined;
  const inConversation = eq(conversationItems.conversationId, params.conversationId);

  return await db().transaction(
    async (tx) => {
      const claimedRows = await tx
        .select()
        .from(conversationItems)
        .where(
          and(
            inConversation,
            isNotNull(conversationItems.seq),
            params.afterSeq === undefined ? undefined : gt(conversationItems.seq, params.afterSeq),
            params.beforeSeq === undefined
              ? undefined
              : lt(conversationItems.seq, params.beforeSeq),
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
    },
    {isolationLevel: 'repeatable read', accessMode: 'read only'},
  );
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
