import type {AssistantMessage, Message, ThinkingLevel} from '@earendil-works/pi-ai';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {newConversationRecordId} from '#db/conversations.js';
import {
  appendTurnEntry,
  deleteStreamChunks,
  getConversationById,
  getTurnById,
  getTurnEntry,
  insertStreamChunk,
} from '#db/turn-runtime.js';
import {
  conversationFirstTokenSeconds,
  conversationModelCallCount,
  conversationThinkingDroppedCount,
} from '#metrics/index.js';
import {CONVERSATION_SESSION_VERSION, parseConversationEntry} from '../conversation-entries.js';
import {
  aadForConversationItem,
  aadForTurnStreamChunk,
  conversationDataKey,
  openConversationEntry,
  sealConversationEntry,
  sealConversationText,
} from '../conversation-sealing.js';
import type {Conversation, ConversationItem} from '../entities/conversation.js';
import {loadConversationContext} from './conversation-session.js';
import {assistantMessageEntry} from './entries.js';
import {classifyProviderError, TurnFailure} from './failures.js';
import {
  type CreateModelRuntime,
  type ModelCallRuntime,
  translateModelSetupError,
} from './model-runtime.js';

export const STREAM_FLUSH_INTERVAL_MS = 150;
export const HEARTBEAT_INTERVAL_MS = 5_000;

export interface ModelCallResult {
  stopReason: 'stop' | 'length' | 'toolUse';
  toolCallCount: number;
}

export interface ModelCallParams {
  conversationId: string;
  turnId: string;
  modelCallIndex: number;
  createModelRuntime: CreateModelRuntime;
  signal?: AbortSignal | undefined;
  heartbeat?: (() => void) | undefined;
}

function toCallResult(message: {stopReason?: unknown; content?: unknown}): ModelCallResult {
  const content = Array.isArray(message.content) ? message.content : [];
  const toolCallCount = content.filter(
    (block) => (block as {type?: unknown}).type === 'toolCall',
  ).length;
  if (message.stopReason === 'length') return {stopReason: 'length', toolCallCount};
  return {stopReason: toolCallCount > 0 ? 'toolUse' : 'stop', toolCallCount};
}

async function storedResult(item: ConversationItem, workspaceId: string): Promise<ModelCallResult> {
  const key = await conversationDataKey(workspaceId);
  const text = openConversationEntry({
    key,
    aad: aadForConversationItem({
      workspaceId,
      conversationId: item.conversationId,
      itemId: item.id,
    }),
    sealed: item.sealedEntry,
  });
  const message = (parseConversationEntry(text)?.message ?? {}) as {
    stopReason?: unknown;
    content?: unknown;
  };
  return toCallResult(message);
}

function recordDiagnostics(message: AssistantMessage): void {
  for (const diagnostic of message.diagnostics ?? []) {
    if (diagnostic.type !== 'anthropic_input_transformations') continue;
    const transformations = (diagnostic.details as {transformations?: unknown} | undefined)
      ?.transformations;
    conversationThinkingDroppedCount.add(
      Array.isArray(transformations) ? transformations.length : 1,
    );
  }
}

/** Seals streamed text into chunks about every 150 ms, so a reader can follow the reply. */
function createChunkWriter(params: {
  workspaceId: string;
  conversationId: string;
  turnId: string;
  modelCallIndex: number;
  key: Awaited<ReturnType<typeof conversationDataKey>>;
}) {
  let buffer = '';
  let chunkSeq = 0;
  let pending: Promise<void> = Promise.resolve();

  const flush = (): void => {
    if (buffer === '') return;
    const text = buffer;
    buffer = '';
    const seq = chunkSeq++;
    pending = pending.then(async () => {
      try {
        await insertStreamChunk({
          turnId: params.turnId,
          modelCallIndex: params.modelCallIndex,
          chunkSeq: seq,
          sealedChunk: sealConversationText({
            key: params.key,
            aad: aadForTurnStreamChunk({
              workspaceId: params.workspaceId,
              conversationId: params.conversationId,
              turnId: params.turnId,
              modelCallIndex: params.modelCallIndex,
              chunkSeq: seq,
            }),
            text,
          }),
        });
      } catch (error) {
        // Chunks only serve a live reader. The stored message is what counts.
        logger().warn(
          {err: error, conversationId: params.conversationId},
          'Failed to store a stream chunk',
        );
      }
    });
  };

  const timer = setInterval(flush, STREAM_FLUSH_INTERVAL_MS);
  return {
    push(text: string) {
      buffer += text;
    },
    async close() {
      clearInterval(timer);
      await pending;
    },
  };
}

interface StreamReplyParams {
  runtime: ModelCallRuntime;
  messages: Message[];
  conversation: Conversation;
  position: {turnId: string; modelCallIndex: number};
  key: Awaited<ReturnType<typeof conversationDataKey>>;
  signal?: AbortSignal | undefined;
  heartbeat?: (() => void) | undefined;
}

/** Streams one reply, flushing text chunks and heartbeating while it runs. */
async function streamReply(params: StreamReplyParams): Promise<AssistantMessage> {
  const {runtime, conversation, position} = params;
  const chunks = createChunkWriter({
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    ...position,
    key: params.key,
  });
  const heartbeat = params.heartbeat
    ? setInterval(params.heartbeat, HEARTBEAT_INTERVAL_MS)
    : undefined;

  try {
    const startedAt = performance.now();
    let sawFirstText = false;
    const stream = runtime.stream(
      {messages: params.messages},
      {
        sessionId: conversation.id,
        ...(params.signal ? {signal: params.signal} : {}),
        ...(runtime.thinking === 'default' || runtime.thinking === 'off'
          ? {}
          : {reasoning: runtime.thinking as ThinkingLevel}),
      },
    );
    for await (const event of stream) {
      if (event.type !== 'text_delta') continue;
      if (!sawFirstText) {
        sawFirstText = true;
        conversationFirstTokenSeconds.record((performance.now() - startedAt) / 1000, {
          origin: conversation.originKind,
        });
      }
      chunks.push(event.delta);
    }
    return await stream.result();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await chunks.close();
  }
}

/** Turns a reply that isn't one the timeline can hold into the failure a turn records. */
async function assertUsableReply(message: AssistantMessage, runtime: ModelCallRuntime) {
  if (message.stopReason === 'aborted') {
    throw new TurnFailure('provider_unavailable', 'The model call was interrupted', true);
  }
  if (message.stopReason !== 'error') return;

  const {isContextOverflow} = await import('@earendil-works/pi-ai');
  throw isContextOverflow(message, runtime.model.contextWindow)
    ? new TurnFailure('context_overflow', message.errorMessage ?? 'The prompt is too long', false)
    : classifyProviderError(message.errorMessage);
}

async function storeReply(params: {
  conversation: Conversation;
  position: {turnId: string; modelCallIndex: number};
  message: AssistantMessage;
  key: Awaited<ReturnType<typeof conversationDataKey>>;
}): Promise<ModelCallResult> {
  const {conversation, message} = params;
  const itemId = await newConversationRecordId();
  const {item} = await appendTurnEntry({
    conversationId: conversation.id,
    position: params.position,
    completesModelCall: true,
    entry: {
      id: itemId,
      entryType: 'message',
      sessionVersion: CONVERSATION_SESSION_VERSION,
      sealedEntry: sealConversationEntry({
        key: params.key,
        aad: aadForConversationItem({
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          itemId,
        }),
        entry: assistantMessageEntry(message),
      }),
      meta: {role: 'assistant', stop_reason: message.stopReason, model: message.model},
    },
  });
  conversationModelCallCount.add(1, {outcome: 'stored'});
  // A concurrent attempt may have stored first, and its reply is the one the timeline holds.
  return item.id === itemId
    ? toCallResult(message)
    : await storedResult(item, conversation.workspaceId);
}

/**
 * One model call of a turn. It rebuilds the prompt from the stored entries, streams the reply,
 * and stores it whole, as one entry, in one transaction. A repeat after that commit returns the
 * stored reply. A failed call stores nothing, so Retry runs it again.
 */
export async function runModelCall(params: ModelCallParams): Promise<ModelCallResult> {
  const [turn, conversation] = await Promise.all([
    getTurnById(params.turnId),
    getConversationById(params.conversationId),
  ]);
  if (!turn || !conversation) {
    throw new TurnFailure('internal_error', 'The turn or its conversation is gone', false);
  }
  const position = {turnId: turn.id, modelCallIndex: params.modelCallIndex};

  const stored = await getTurnEntry(position);
  if (stored) {
    conversationModelCallCount.add(1, {outcome: 'replayed'});
    return await storedResult(stored, conversation.workspaceId);
  }

  await deleteStreamChunks(position);
  try {
    const messages = await loadConversationContext({conversation});
    const runtime = await params
      .createModelRuntime({conversation, turn, renewal: turn.modelCallCount > 0})
      .catch(translateModelSetupError);
    const key = await conversationDataKey(conversation.workspaceId);
    const message = await streamReply({
      runtime,
      messages,
      conversation,
      position,
      key,
      signal: params.signal,
      heartbeat: params.heartbeat,
    });
    await assertUsableReply(message, runtime);
    recordDiagnostics(message);
    return await storeReply({conversation, position, message, key});
  } catch (error) {
    conversationModelCallCount.add(1, {outcome: 'failed'});
    if (!(error instanceof TurnFailure)) {
      reportError(error, {boundary: 'agent.conversation.model_call'});
    }
    throw error;
  }
}
