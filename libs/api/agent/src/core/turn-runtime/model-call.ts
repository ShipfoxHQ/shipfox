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
  isTurnStopRequested,
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
import {type CompactionCause, promptNeedsCompaction} from './compaction.js';
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
export const STOP_POLL_INTERVAL_MS = 500;

/**
 * What a model call tells the workflow. `compact` means nothing was stored: the prompt has to
 * shrink first, and the same call runs again afterwards.
 */
export type ModelCallResult =
  | {
      /** `stopped` means the user stopped the reply, and the stored message is the partial one. */
      stopReason: 'stop' | 'length' | 'toolUse' | 'stopped';
      toolCallCount: number;
    }
  | {stopReason: 'compact'; toolCallCount: 0; compactionCause: CompactionCause};

type StoredCallResult = Exclude<ModelCallResult, {stopReason: 'compact'}>;

export interface ModelCallParams {
  conversationId: string;
  turnId: string;
  modelCallIndex: number;
  createModelRuntime: CreateModelRuntime;
  signal?: AbortSignal | undefined;
  heartbeat?: (() => void) | undefined;
}

function toCallResult(message: {stopReason?: unknown; content?: unknown}): StoredCallResult {
  // pi leaves a stopped message out of prompts, so its half-written tool calls never run.
  if (message.stopReason === 'aborted') return {stopReason: 'stopped', toolCallCount: 0};
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
      flush();
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

/**
 * Watches for a stop request while a reply streams, and aborts the stream when one arrives.
 * Temporal cancellation isn't used, so the activity returns normally and stores what it has.
 */
function watchForStop(params: {turnId: string; abort: () => void}) {
  let requested = false;
  let polling = false;
  const timer = setInterval(() => {
    if (polling || requested) return;
    polling = true;
    isTurnStopRequested(params.turnId)
      .then((stopRequested) => {
        if (!stopRequested) return;
        requested = true;
        params.abort();
      })
      // A missed poll is tried again 500 ms later. The stop is stored, so none is lost.
      .catch((error: unknown) => logger().warn({err: error}, 'Failed to poll for a stop request'))
      .finally(() => {
        polling = false;
      });
  }, STOP_POLL_INTERVAL_MS);
  return {
    get requested() {
      return requested;
    },
    close: () => clearInterval(timer),
  };
}

/** Streams one reply, flushing text chunks and heartbeating while it runs. */
async function streamReply(
  params: StreamReplyParams,
): Promise<{message: AssistantMessage; stopRequested: boolean}> {
  const {runtime, conversation, position} = params;
  const abortController = new AbortController();
  const stop = watchForStop({turnId: position.turnId, abort: () => abortController.abort()});
  const signal = params.signal
    ? AbortSignal.any([params.signal, abortController.signal])
    : abortController.signal;
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
        signal,
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
    return {message: await stream.result(), stopRequested: stop.requested};
  } finally {
    stop.close();
    if (heartbeat) clearInterval(heartbeat);
    await chunks.close();
  }
}

/** True when the provider rejected the prompt for its size. The estimate can miss this. */
async function isPromptOverflow(message: AssistantMessage, runtime: ModelCallRuntime) {
  if (message.stopReason !== 'error') return false;
  const {isContextOverflow} = await import('@earendil-works/pi-ai');
  return isContextOverflow(message, runtime.model.contextWindow);
}

/** Turns a reply that isn't one the timeline can hold into the failure a turn records. */
function assertUsableReply(message: AssistantMessage) {
  if (message.stopReason === 'aborted') {
    throw new TurnFailure('provider_unavailable', 'The model call was interrupted', true);
  }
  if (message.stopReason !== 'error') return;
  throw classifyProviderError(message.errorMessage);
}

async function storeReply(params: {
  conversation: Conversation;
  position: {turnId: string; modelCallIndex: number};
  message: AssistantMessage;
  key: Awaited<ReturnType<typeof conversationDataKey>>;
}): Promise<ModelCallResult> {
  const {conversation, message} = params;
  const itemId = await newConversationRecordId();
  const appended = await appendTurnEntry({
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
  if (!appended) throw new TurnFailure('internal_error', 'The turn ended before its reply', false);
  conversationModelCallCount.add(1, {outcome: appended.stored ? 'stored' : 'replayed'});
  // A concurrent attempt may have stored first, and its reply is the one the timeline holds.
  return appended.stored
    ? toCallResult(message)
    : await storedResult(appended.item, conversation.workspaceId);
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
    const pi = await import('@earendil-works/pi-coding-agent');
    const messages = await loadConversationContext({conversation, pi});
    const runtime = await params
      .createModelRuntime({conversation, turn, renewal: turn.modelCallCount > 0})
      .catch(translateModelSetupError);
    if (promptNeedsCompaction({pi, messages, contextWindow: runtime.model.contextWindow})) {
      return {stopReason: 'compact', toolCallCount: 0, compactionCause: 'estimate'};
    }
    const key = await conversationDataKey(conversation.workspaceId);
    const {message, stopRequested} = await streamReply({
      runtime,
      messages,
      conversation,
      position,
      key,
      signal: params.signal,
      heartbeat: params.heartbeat,
    });
    if (await isPromptOverflow(message, runtime)) {
      return {stopReason: 'compact', toolCallCount: 0, compactionCause: 'overflow'};
    }
    // A stopped reply is a result, not a failure: the partial message joins the timeline.
    if (!(stopRequested && message.stopReason === 'aborted')) assertUsableReply(message);
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
