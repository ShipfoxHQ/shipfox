import {
  type ConversationItemContentDto,
  type ConversationItemDto,
  type ConversationStreamEventDto,
  conversationStreamEventSchema,
} from '@shipfox/api-agent-dto';
import {ApiError, checkedApiEventStream} from '@shipfox/client-api';
import {experimental_streamedQuery as streamedQuery, useQuery} from '@tanstack/react-query';
import {
  type ConversationStreamEvent,
  type ConversationStreamState,
  createConversationStreamState,
  isFinalTurnStatus,
  reconnectDelayMs,
  reduceConversationStream,
  type StreamedItem,
} from '#core/conversation-stream.js';

export interface ConversationStreamItem extends StreamedItem {
  entryType: string;
  /** Null when the stored entry cannot be opened. */
  content: ConversationItemContentDto | null;
  createdAt: string;
}

export type ConversationStreamSnapshot = ConversationStreamState<ConversationStreamItem>;

export const conversationStreamQueryKeys = {
  all: ['conversation-stream'] as const,
  detail: (conversationId: string) =>
    [...conversationStreamQueryKeys.all, 'detail', conversationId] as const,
};

const MAX_FAILURES_IN_A_ROW = 5;
/** A stream that closes with its turn still running is reopened soon, not at once. */
const REOPEN_DELAY_MS = 250;

function toStreamItem(dto: ConversationItemDto): ConversationStreamItem {
  return {
    id: dto.id,
    seq: dto.seq,
    turnId: dto.turn_id,
    entryType: dto.entry_type,
    content: dto.content,
    createdAt: dto.created_at,
  };
}

function toStreamEvent(
  message: ConversationStreamEventDto,
): ConversationStreamEvent<ConversationStreamItem> {
  switch (message.event) {
    case 'queued':
      return {kind: 'queued', item: toStreamItem(message.data)};
    case 'item':
      return {kind: 'item', item: toStreamItem(message.data)};
    case 'delta':
      return {kind: 'text', text: message.data.text};
    case 'reset':
      return {kind: 'reset'};
    case 'turn':
      return {
        kind: 'turn',
        turnId: message.data.turn_id,
        status: message.data.status,
        failureCode: message.data.failure_code,
      };
  }
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

function isDroppedConnection(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'network-error';
}

interface StreamConversationEventsParams {
  conversationId: string;
  /** The last `seq` the caller holds. */
  afterSeq: number;
  signal?: AbortSignal | undefined;
}

/** What one connection taught the loop that reconnects it. */
interface Connection {
  afterSeq: number;
  turnRunning: boolean;
  turnFinal: boolean;
  /** The stream delivered an item the caller did not hold, or more text than any earlier one. */
  progressed: boolean;
  /** Text of the running call as this connection has rebuilt it since its `reset`. */
  textLength: number;
  /** The most text any connection has rebuilt for the running call. Replays do not beat it. */
  longestText: number;
}

function observe(connection: Connection, event: ConversationStreamEvent<ConversationStreamItem>) {
  if (event.kind === 'item' && event.item.seq !== null && event.item.seq > connection.afterSeq) {
    connection.afterSeq = event.item.seq;
    connection.progressed = true;
    connection.textLength = 0;
    connection.longestText = 0;
  }
  if (event.kind === 'reset') connection.textLength = 0;
  if (event.kind === 'text') {
    connection.textLength += event.text.length;
    if (connection.textLength > connection.longestText) {
      connection.longestText = connection.textLength;
      connection.progressed = true;
    }
  }
  if (event.kind === 'turn') {
    connection.turnFinal = isFinalTurnStatus(event.status);
    connection.turnRunning = !connection.turnFinal;
  }
}

async function* readConnection(params: {
  conversationId: string;
  connection: Connection;
  signal: AbortSignal | undefined;
}): AsyncGenerator<ConversationStreamEvent<ConversationStreamItem>> {
  const {conversationId, connection, signal} = params;
  connection.turnRunning = false;
  connection.turnFinal = false;
  connection.progressed = false;
  connection.textLength = 0;
  const query = new URLSearchParams({after_seq: String(connection.afterSeq)});
  const messages = checkedApiEventStream(
    conversationStreamEventSchema,
    `/conversations/${encodeURIComponent(conversationId)}/stream?${query.toString()}`,
    {signal},
  );
  for await (const message of messages) {
    const event = toStreamEvent(message);
    observe(connection, event);
    yield event;
  }
}

/** Rethrows what a new connection cannot fix, and a drop that keeps repeating. */
function countFailure(params: {
  error: unknown;
  failuresInARow: number;
  connection: Connection;
  signal: AbortSignal | undefined;
}): number {
  const {error, connection, signal} = params;
  if (signal?.aborted || !isDroppedConnection(error)) throw error;
  const failures = connection.progressed ? 1 : params.failuresInARow + 1;
  if (failures > MAX_FAILURES_IN_A_ROW) throw error;
  return failures;
}

/**
 * Follows a conversation's active turn. A dropped connection reconnects from the last item
 * received, and the server sends the running call's text again from its first chunk after a
 * `reset`, so no cursor tracks text. It ends with the turn, or when no turn runs. It throws
 * after repeated drops, and for any refusal other than a dropped connection.
 */
export async function* streamConversationEvents(
  params: StreamConversationEventsParams,
): AsyncGenerator<ConversationStreamEvent<ConversationStreamItem>> {
  const {conversationId, signal} = params;
  const connection: Connection = {
    afterSeq: params.afterSeq,
    turnRunning: false,
    turnFinal: false,
    progressed: false,
    textLength: 0,
    longestText: 0,
  };
  let failuresInARow = 0;

  while (true) {
    try {
      yield* readConnection({conversationId, connection, signal});
    } catch (error) {
      failuresInARow = countFailure({error, failuresInARow, connection, signal});
      await wait(reconnectDelayMs(failuresInARow), signal);
      continue;
    }
    failuresInARow = 0;
    if (connection.turnFinal || !connection.turnRunning) return;
    await wait(REOPEN_DELAY_MS, signal);
  }
}

export interface UseConversationStreamParams {
  conversationId: string | undefined;
  /** The last `seq` already loaded, so the stream sends only what follows. */
  afterSeq: number;
  /** Open the stream only while a turn is active. */
  enabled: boolean;
}

/**
 * The live state of a conversation's active turn. The query stays fetching while the stream is
 * open and holds what the stream has sent so far. It is an exception to the shared query policy
 * because it refetches only when enabled again for the next turn, and an open connection owns its
 * own retries.
 */
export function useConversationStream({
  conversationId,
  afterSeq,
  enabled,
}: UseConversationStreamParams) {
  return useQuery({
    queryKey: conversationStreamQueryKeys.detail(conversationId ?? ''),
    queryFn: streamedQuery<
      ConversationStreamEvent<ConversationStreamItem>,
      ConversationStreamSnapshot
    >({
      streamFn: ({signal}) =>
        streamConversationEvents({conversationId: conversationId ?? '', afterSeq, signal}),
      reducer: reduceConversationStream,
      initialValue: createConversationStreamState<ConversationStreamItem>(afterSeq),
      refetchMode: 'reset',
    }),
    enabled: enabled && conversationId !== undefined,
    // A finished stream is stale, so enabling the hook for the next turn opens a new one.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}
