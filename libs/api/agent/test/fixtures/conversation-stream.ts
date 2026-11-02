import {eq} from 'drizzle-orm';
import {CONVERSATION_SESSION_VERSION} from '#core/conversation-entries.js';
import {
  aadForConversationItem,
  aadForTurnStreamChunk,
  conversationDataKey,
  sealConversationEntry,
  sealConversationText,
} from '#core/conversation-sealing.js';
import type {OpenConversation} from '#core/entities/conversation.js';
import {newConversationRecordId} from '#db/conversations.js';
import {db} from '#db/db.js';
import {turns} from '#db/schema/turns.js';
import {appendTurnEntry, insertStreamChunk} from '#db/turn-runtime.js';

type ConversationRef = Pick<OpenConversation, 'id' | 'workspaceId'>;

/** Writes a sealed chunk of the running model call, as the model call does. */
export async function storeStreamChunk(params: {
  conversation: ConversationRef;
  turnId: string;
  modelCallIndex: number;
  chunkSeq: number;
  text: string;
}): Promise<void> {
  const {conversation} = params;
  await insertStreamChunk({
    turnId: params.turnId,
    modelCallIndex: params.modelCallIndex,
    chunkSeq: params.chunkSeq,
    sealedChunk: sealConversationText({
      key: await conversationDataKey(conversation.workspaceId),
      aad: aadForTurnStreamChunk({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        turnId: params.turnId,
        modelCallIndex: params.modelCallIndex,
        chunkSeq: params.chunkSeq,
      }),
      text: params.text,
    }),
  });
}

/** Stores the reply of a model call, which also clears the call's chunks. */
export async function storeReply(params: {
  conversation: ConversationRef;
  turnId: string;
  modelCallIndex: number;
  text: string;
}) {
  const {conversation} = params;
  const id = await newConversationRecordId();
  const appended = await appendTurnEntry({
    conversationId: conversation.id,
    position: {turnId: params.turnId, modelCallIndex: params.modelCallIndex},
    completesModelCall: true,
    entry: {
      id,
      entryType: 'message',
      sessionVersion: CONVERSATION_SESSION_VERSION,
      sealedEntry: sealConversationEntry({
        key: await conversationDataKey(conversation.workspaceId),
        aad: aadForConversationItem({
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          itemId: id,
        }),
        entry: JSON.stringify({
          type: 'message',
          timestamp: '2026-11-02T00:00:00.000Z',
          message: {role: 'assistant', content: [{type: 'text', text: params.text}]},
        }),
      }),
      meta: {role: 'assistant', stop_reason: 'stop'},
    },
  });
  if (!appended) throw new Error('The turn is not running');
  return appended.item;
}

export async function endTurn(params: {
  turnId: string;
  status: 'succeeded' | 'failed' | 'stopped';
  failureCode?: string;
}): Promise<void> {
  await db()
    .update(turns)
    .set({
      status: params.status,
      failureCode: params.failureCode ?? null,
      finishedAt: new Date(),
    })
    .where(eq(turns.id, params.turnId));
}
