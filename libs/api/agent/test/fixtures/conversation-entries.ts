import {eq, sql} from 'drizzle-orm';
import {CONVERSATION_SESSION_VERSION} from '#core/conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  sealConversationEntry,
} from '#core/conversation-sealing.js';
import type {ConversationItemMeta, OpenConversation} from '#core/entities/conversation.js';
import {newConversationRecordId} from '#db/conversations.js';
import {db} from '#db/db.js';
import {conversationItems} from '#db/schema/conversation-items.js';
import {conversations} from '#db/schema/conversations.js';

/** Appends a claimed entry the way a turn will, for entries no route writes yet. */
export async function appendConversationEntry(params: {
  conversation: Pick<OpenConversation, 'id' | 'workspaceId'>;
  entry: string | Record<string, unknown>;
  meta?: ConversationItemMeta;
  turnId?: string;
  modelCallIndex?: number;
  callIndex?: number;
}): Promise<string> {
  const {conversation, entry} = params;
  const id = await newConversationRecordId();
  const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
  const key = await conversationDataKey(conversation.workspaceId);

  const [row] = await db()
    .update(conversations)
    .set({lastSeq: sql`${conversations.lastSeq} + 1`})
    .where(eq(conversations.id, conversation.id))
    .returning({seq: conversations.lastSeq});
  await db()
    .insert(conversationItems)
    .values({
      id,
      conversationId: conversation.id,
      seq: row?.seq as number,
      entryType: typeof entry === 'string' ? 'message' : String(entry.type),
      sessionVersion: CONVERSATION_SESSION_VERSION,
      meta: params.meta,
      turnId: params.turnId,
      modelCallIndex: params.modelCallIndex,
      callIndex: params.callIndex,
      body: sealConversationEntry({
        key,
        aad: aadForConversationItem({
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          itemId: id,
        }),
        entry: text,
      }),
    });
  return id;
}
