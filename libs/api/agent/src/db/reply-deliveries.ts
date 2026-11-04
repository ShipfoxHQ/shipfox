import {and, desc, eq, gt, isNull, sql} from 'drizzle-orm';
import {type ConversationItem, TURN_NOTICE_CUSTOM_TYPE} from '#core/entities/conversation.js';
import {db} from './db.js';
import {conversationItems, toConversationItem} from './schema/conversation-items.js';
import {replyDeliveries} from './schema/reply-deliveries.js';
import {turns} from './schema/turns.js';

export type ReplyDeliveryOutcome = (typeof replyDeliveries.$inferSelect)['outcome'];

export async function hasReplyDelivery(replyId: string): Promise<boolean> {
  const rows = await db()
    .select({replyId: replyDeliveries.replyId})
    .from(replyDeliveries)
    .where(eq(replyDeliveries.replyId, replyId))
    .limit(1);
  return rows.length > 0;
}

export async function getReplyDeliveryOutcome(
  replyId: string,
): Promise<ReplyDeliveryOutcome | undefined> {
  const rows = await db()
    .select({outcome: replyDeliveries.outcome})
    .from(replyDeliveries)
    .where(eq(replyDeliveries.replyId, replyId))
    .limit(1);
  return rows[0]?.outcome;
}

/** Notes that a reply is handled. A repeat leaves the first outcome in place. */
export async function recordReplyDelivery(params: {
  replyId: string;
  conversationId: string;
  outcome: ReplyDeliveryOutcome;
}): Promise<void> {
  await db().insert(replyDeliveries).values(params).onConflictDoNothing();
}

/** The last assistant message a turn stored, which is its answer once the turn is over. */
export async function getLastTurnAssistantItem(
  turnId: string,
): Promise<ConversationItem | undefined> {
  const rows = await db()
    .select()
    .from(conversationItems)
    .where(
      and(
        eq(conversationItems.turnId, turnId),
        sql`${conversationItems.meta}->>'role' = 'assistant'`,
      ),
    )
    .orderBy(desc(conversationItems.seq))
    .limit(1);
  const row = rows[0];
  return row ? toConversationItem(row) : undefined;
}

/**
 * The notice that explains the latest denial, when nobody has been told yet. A denial opens no
 * turn, so its notice is the only trace: it has no turn and follows the latest turn.
 */
export async function findUndeliveredDenialNotice(
  conversationId: string,
): Promise<ConversationItem | undefined> {
  const [latestTurn] = await db()
    .select({startedAt: turns.startedAt})
    .from(turns)
    .where(eq(turns.conversationId, conversationId))
    .orderBy(desc(turns.id))
    .limit(1);
  const [notice] = await db()
    .select()
    .from(conversationItems)
    .where(
      and(
        eq(conversationItems.conversationId, conversationId),
        eq(conversationItems.entryType, 'custom'),
        isNull(conversationItems.turnId),
        sql`${conversationItems.meta}->>'custom_type' = ${TURN_NOTICE_CUSTOM_TYPE}`,
        latestTurn ? gt(conversationItems.createdAt, latestTurn.startedAt) : undefined,
      ),
    )
    .orderBy(desc(conversationItems.id))
    .limit(1);
  if (!notice || (await hasReplyDelivery(notice.id))) return undefined;
  return toConversationItem(notice);
}
