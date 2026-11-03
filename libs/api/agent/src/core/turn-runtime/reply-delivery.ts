import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {
  findUndeliveredDenialNotice,
  getLastTurnAssistantItem,
  hasReplyDelivery,
  recordReplyDelivery,
} from '#db/reply-deliveries.js';
import {getConversationById, getTurnById, settleUndeliverableReply} from '#db/turn-runtime.js';
import {conversationReplyCount} from '#metrics/index.js';
import {isRecord, parseConversationEntry} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
} from '../conversation-sealing.js';
import type {Conversation, ConversationItem} from '../entities/conversation.js';
import {SHIPPY_AGENT_KEY, SHIPPY_AGENT_NAME} from '../shippy.js';
import type {TurnFailureCode} from './failure-codes.js';
import {CONTEXT_OVERFLOW_NOTICE, sealTurnNotice} from './turn-lifecycle.js';

export const STOPPED_REPLY_TEXT = 'Stopped.';
export const REPLY_UNDELIVERABLE_NOTICE_CODE = 'reply-undeliverable';

const FAILURE_REPLY_TEXT: Record<TurnFailureCode, string> = {
  step_limit: 'I stopped because this took too many steps. Try a smaller request.',
  provider_error: "The model provider returned an error, so I couldn't answer.",
  provider_unavailable: "The model provider is unavailable, so I couldn't answer. Try again.",
  context_overflow: CONTEXT_OVERFLOW_NOTICE,
  model_unavailable: "No model is available for this workspace, so I couldn't answer.",
  credentials_unavailable: "The model credentials are unavailable, so I couldn't answer.",
  session_unreadable: "I couldn't read this conversation, so I couldn't answer.",
  tool_catalog_unavailable: "My tools are unavailable, so I couldn't answer. Try again.",
  timeout: 'The answer took too long. Try again.',
  internal_error: "Something went wrong, so I couldn't answer. Try again.",
};

/** Codes that never change on a repeat, so the reply is `undeliverable` instead of retried. */
const PERMANENT_DELIVERY_ERRORS = new Set([
  'connection-not-found',
  'connection-inactive',
  'connection-workspace-mismatch',
  'capability-unavailable',
]);

type InteractionIntegrations = Pick<
  IntegrationsModuleClient,
  'sendInteractionReply' | 'reportInteractionProgress'
>;

interface Reply {
  replyId: string;
  /** Absent when the turn has nothing to say. */
  message?: {kind: 'response' | 'error'; text: string} | undefined;
}

function agentName(conversation: Conversation): string {
  return conversation.agentKey === SHIPPY_AGENT_KEY ? SHIPPY_AGENT_NAME : conversation.agentKey;
}

async function openEntry(conversation: Conversation, item: ConversationItem): Promise<string> {
  return openConversationEntry({
    key: await conversationDataKey(conversation.workspaceId),
    aad: aadForConversationItem({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      itemId: item.id,
    }),
    sealed: item.sealedEntry,
  });
}

/** The text blocks of a stored assistant message, and whether a stop cut it short. */
async function assistantReply(
  conversation: Conversation,
  item: ConversationItem,
): Promise<{text: string; aborted: boolean}> {
  const message = parseConversationEntry(await openEntry(conversation, item))?.message;
  if (!isRecord(message)) return {text: '', aborted: false};
  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = blocks
    .flatMap((block) =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string'
        ? [block.text]
        : [],
    )
    .join('')
    .trim();
  return {text, aborted: message.stopReason === 'aborted'};
}

async function turnReply(conversation: Conversation, turnId: string): Promise<Reply | undefined> {
  const turn = await getTurnById(turnId);
  if (!turn || turn.conversationId !== conversation.id || turn.status === 'running') {
    return undefined;
  }
  const replyId = turn.id;

  if (turn.status === 'failed') {
    const code = (turn.failureCode ?? 'internal_error') as TurnFailureCode;
    return {
      replyId,
      message: {kind: 'error', text: FAILURE_REPLY_TEXT[code] ?? FAILURE_REPLY_TEXT.internal_error},
    };
  }

  const last = await getLastTurnAssistantItem(turn.id);
  const answer = last ? await assistantReply(conversation, last) : undefined;
  if (turn.status === 'stopped') {
    // A stop that lands between model calls leaves earlier narration, which isn't the answer.
    const partial = answer?.aborted ? answer.text : '';
    return {replyId, message: {kind: 'response', text: partial || STOPPED_REPLY_TEXT}};
  }
  return {
    replyId,
    message: answer?.text ? {kind: 'response', text: answer.text} : undefined,
  };
}

async function denialReply(conversation: Conversation): Promise<Reply | undefined> {
  const notice = await findUndeliveredDenialNotice(conversation.id);
  if (!notice) return undefined;
  const entry = parseConversationEntry(await openEntry(conversation, notice));
  const data = isRecord(entry?.data) ? entry.data : {};
  const action = isRecord(data.required_action) ? data.required_action : {};
  const text =
    [data.message, action.message].find(
      (value): value is string => typeof value === 'string' && value !== '',
    ) ?? "I can't reply right now.";
  return {replyId: notice.id, message: {kind: 'error', text}};
}

async function sendReply(params: {
  conversation: Conversation;
  integrations: InteractionIntegrations;
  replyId: string;
  message: NonNullable<Reply['message']>;
  origin: {connectionId: string; key: string; provider: string};
}): Promise<void> {
  const {conversation, message, origin, replyId} = params;
  const metric = {provider: origin.provider, kind: message.kind} as const;
  let undeliverableReason: string | undefined;
  try {
    const outcome = await params.integrations.sendInteractionReply({
      workspaceId: conversation.workspaceId,
      connectionId: origin.connectionId,
      conversationKey: origin.key,
      replyId,
      kind: message.kind,
      text: message.text,
      agent: {name: agentName(conversation)},
    });
    if (outcome.outcome === 'undeliverable') undeliverableReason = outcome.reason;
  } catch (error) {
    if (
      !isInterModuleKnownError(
        integrationsInterModuleContract.methods.sendInteractionReply,
        error,
      ) ||
      !PERMANENT_DELIVERY_ERRORS.has(error.code)
    ) {
      throw error;
    }
    undeliverableReason = error.code;
  }

  if (undeliverableReason === undefined) {
    await recordReplyDelivery({replyId, conversationId: conversation.id, outcome: 'delivered'});
    conversationReplyCount.add(1, {...metric, outcome: 'delivered'});
    return;
  }
  logger().warn(
    {conversationId: conversation.id, provider: origin.provider, reason: undeliverableReason},
    'An agent reply is undeliverable',
  );
  const notice = await sealTurnNotice(conversation, {
    code: REPLY_UNDELIVERABLE_NOTICE_CODE,
    message: `The reply could not be delivered to ${origin.provider}: ${undeliverableReason}`,
    required_action: null,
  });
  if (await settleUndeliverableReply({replyId, conversationId: conversation.id, notice})) {
    conversationReplyCount.add(1, {...metric, outcome: 'undeliverable'});
  }
}

/**
 * Clears the provider's loading status. It is best effort: the reply is what matters, and a
 * provider clears its own status when a reply lands.
 */
async function clearProgress(params: {
  conversation: Conversation;
  integrations: InteractionIntegrations;
  origin: {connectionId: string; key: string};
}): Promise<void> {
  try {
    await params.integrations.reportInteractionProgress({
      workspaceId: params.conversation.workspaceId,
      connectionId: params.origin.connectionId,
      conversationKey: params.origin.key,
      state: 'idle',
    });
  } catch (error) {
    logger().warn(
      {err: error, conversationId: params.conversation.id},
      'Failed to clear the progress of an agent conversation',
    );
  }
}

/**
 * Sends what a turn produced back through the provider that started the conversation, then
 * clears its progress. With a `turnId` it sends that finished turn's answer, or its failure or
 * stop. Without one it tells the person about a denial, which opened no turn. A turn with no
 * text sends nothing, and a reply already handled is not sent again. An undeliverable reply is
 * recorded and never retried. Web conversations are read by the client, so they do nothing.
 */
export async function deliverConversationReply(params: {
  conversationId: string;
  turnId?: string | undefined;
  integrations: InteractionIntegrations;
}): Promise<void> {
  const conversation = await getConversationById(params.conversationId);
  if (
    conversation?.originKind !== 'integration' ||
    conversation.originConnectionId === null ||
    conversation.originProvider === null ||
    conversation.originKey === null
  ) {
    return;
  }
  const origin = {
    connectionId: conversation.originConnectionId,
    provider: conversation.originProvider,
    key: conversation.originKey,
  };

  const reply =
    params.turnId === undefined
      ? await denialReply(conversation)
      : await turnReply(conversation, params.turnId);
  if (!reply) return;

  try {
    if (!(await hasReplyDelivery(reply.replyId))) {
      if (reply.message) {
        await sendReply({
          conversation,
          integrations: params.integrations,
          replyId: reply.replyId,
          message: reply.message,
          origin,
        });
      } else {
        await recordReplyDelivery({
          replyId: reply.replyId,
          conversationId: conversation.id,
          outcome: 'skipped',
        });
      }
    }
  } finally {
    // Also after a failed send and a repeat, so the status never outlives the turn.
    await clearProgress({conversation, integrations: params.integrations, origin});
  }
}
