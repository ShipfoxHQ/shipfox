import type {AgentPageContext} from '@shipfox/client-shell/runtime';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {lastItemSeq, mergeItemPages, withLiveItems} from '#core/conversation.js';
import {buildTranscript} from '#core/transcript.js';
import {
  currentTurn,
  partialTextOf,
  RECONNECTING_NOTICE_MS,
  replyActivity,
  SLOW_START_MS,
} from '#core/turn-state.js';
import {useElapsed, useSince} from '#hooks/use-elapsed.js';
import {useConversationStream} from './conversation-stream.js';
import {
  CONVERSATION_POLL_INTERVAL_MS,
  isConversationNotFound,
  useConversationDetailQuery,
  useConversationItemsQuery,
  useConversationRefresh,
  useCreateConversationMutation,
  useMarkConversationReadMutation,
  useRetryConversationMutation,
  useSendConversationMessageMutation,
  useStopConversationMutation,
} from './conversations.js';

export interface UseChatConversationParams {
  projectId: string;
  /** Undefined for a conversation that the first message creates. */
  conversationId: string | undefined;
  /** Reads pause while the panel is closed. */
  active: boolean;
  onCreated: (conversationId: string) => void;
}

/**
 * Everything the panel shows about one conversation. Polls while no turn runs, and follows the
 * stream while one does, so a reply keeps streaming as the user moves between project pages.
 */
/** A retry is picked up once a newer turn opens, or once a refusal adds its notice. */
function useRetryPickup(turnId: string | undefined, lastSeq: number) {
  const [pending, setPending] = useState<{fromTurnId: string | null; fromSeq: number}>();

  useEffect(() => {
    if (pending && ((turnId ?? null) !== pending.fromTurnId || lastSeq > pending.fromSeq)) {
      setPending(undefined);
    }
  }, [pending, turnId, lastSeq]);

  const start = useCallback(
    () => setPending({fromTurnId: turnId ?? null, fromSeq: lastSeq}),
    [turnId, lastSeq],
  );
  const cancel = useCallback(() => setPending(undefined), []);
  return {awaitingRetry: pending !== undefined, start, cancel};
}

/** A stream that gave up leaves polling in charge, and tries again after one poll interval. */
function useStreamRecovery(params: {
  failedAt: number | undefined;
  turnRunning: boolean;
  refetch: () => unknown;
}) {
  const {failedAt, turnRunning, refetch} = params;
  useEffect(() => {
    if (failedAt === undefined || !turnRunning) return;
    const timer = setTimeout(() => void refetch(), CONVERSATION_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [failedAt, turnRunning, refetch]);
}

/** Marks the conversation read while the user can see it. */
function useMarkRead(params: {
  projectId: string;
  conversationId: string | undefined;
  unread: boolean;
  lastSeq: number;
  active: boolean;
}) {
  const {projectId, conversationId, unread, lastSeq, active} = params;
  const {mutate} = useMarkConversationReadMutation(projectId);
  useEffect(() => {
    if (!active || !unread || !conversationId || lastSeq === 0) return;
    if (document.visibilityState !== 'visible') return;
    mutate({conversationId, lastReadSeq: lastSeq});
  }, [active, unread, conversationId, lastSeq, mutate]);
}

/** Follows the active turn while one runs or an input waits, and reads it again when it ends. */
function useLiveTurn(params: {
  conversationId: string | undefined;
  afterSeq: number;
  enabled: boolean;
  turnRunning: boolean;
}) {
  const stream = useConversationStream({
    conversationId: params.conversationId,
    afterSeq: params.afterSeq,
    enabled: params.enabled,
  });
  const streaming = stream.fetchStatus === 'fetching';
  const live = stream.data;

  const refresh = useConversationRefresh(params.conversationId);
  const endedStatus = streaming ? undefined : live?.turn?.status;
  useEffect(() => {
    if (endedStatus !== undefined && endedStatus !== 'running') void refresh();
  }, [endedStatus, refresh]);

  useStreamRecovery({
    failedAt: stream.isError ? stream.errorUpdatedAt : undefined,
    turnRunning: params.turnRunning,
    refetch: stream.refetch,
  });

  // A stream that gave up is down too, until it reopens.
  const disconnectedSince = useSince(
    params.turnRunning && ((streaming && (live?.reconnecting ?? false)) || stream.isError),
  );
  return {
    streaming,
    // A stream that dropped keeps its text on screen while the turn still runs.
    live: streaming || params.turnRunning ? live : undefined,
    stored: live,
    reconnecting: useElapsed(disconnectedSince, RECONNECTING_NOTICE_MS),
  };
}

export function useChatConversation({
  projectId,
  conversationId,
  active,
  onCreated,
}: UseChatConversationParams) {
  const [streamOpen, setStreamOpen] = useState(false);
  const [stopTurnId, setStopTurnId] = useState<string | undefined>(undefined);
  const poll = active && !streamOpen;

  const detailQuery = useConversationDetailQuery({conversationId, poll});
  const itemsQuery = useConversationItemsQuery({conversationId, poll});
  const {notFound} = readState({conversationId, detailQuery, itemsQuery});

  const base = useMemo(() => mergeItemPages(itemsQuery.data?.pages ?? []), [itemsQuery.data]);
  const storedTurn = detailQuery.data?.latestTurn;
  const turnRunning = storedTurn?.status === 'running';
  const retryPickup = useRetryPickup(storedTurn?.id, lastItemSeq(base.items));

  const liveTurn = useLiveTurn({
    conversationId,
    afterSeq: lastItemSeq(base.items),
    enabled:
      active && !notFound && (turnRunning || base.queued.length > 0 || retryPickup.awaitingRetry),
    turnRunning,
  });
  useEffect(() => setStreamOpen(liveTurn.streaming), [liveTurn.streaming]);

  // Stored stream items stay merged after the stream ends, until the next read holds them.
  const {items, queued} = useMemo(
    () => withLiveItems(base, liveTurn.stored),
    [base, liveTurn.stored],
  );
  const lastSeq = lastItemSeq(items);
  const turn = currentTurn({stored: storedTurn, live: liveTurn.live?.turn});
  const partialText = partialTextOf({live: liveTurn.live, turn});

  const awaitingTurn = !turnRunning && (queued.length > 0 || retryPickup.awaitingRetry);
  const slowStart = useElapsed(useSince(awaitingTurn), SLOW_START_MS);
  const activity = replyActivity({
    turn,
    awaitingTurn,
    slowStart,
    partialText,
    stopRequested: turn !== undefined && stopTurnId === turn.id,
    reconnecting: liveTurn.reconnecting,
  });

  const runningTurnId = turn?.status === 'running' ? turn.id : undefined;
  const transcript = useMemo(
    () => buildTranscript({items, queued, partialText, runningTurnId}),
    [items, queued, partialText, runningTurnId],
  );

  const createMutation = useCreateConversationMutation(projectId);
  const sendMutation = useSendConversationMessageMutation({projectId, conversationId});
  const stopMutation = useStopConversationMutation(conversationId);
  const retryMutation = useRetryConversationMutation(conversationId);
  useMarkRead({
    projectId,
    conversationId,
    unread: detailQuery.data?.unread ?? false,
    lastSeq,
    active,
  });

  const send = useCallback(
    async (params: {
      body: string;
      pageContext: AgentPageContext | undefined;
      /** Used only when the message creates the conversation, which fixes its agent. */
      agentKey?: string | undefined;
    }) => {
      const input = {
        clientMessageId: crypto.randomUUID(),
        body: params.body,
        pageContext: params.pageContext,
      };
      if (conversationId) {
        await sendMutation.mutateAsync(input);
        return;
      }
      const {conversation} = await createMutation.mutateAsync({
        ...input,
        agentKey: params.agentKey,
      });
      onCreated(conversation.id);
    },
    [conversationId, sendMutation, createMutation, onCreated],
  );

  const stop = useCallback(async () => {
    if (runningTurnId === undefined) return;
    setStopTurnId(runningTurnId);
    try {
      await stopMutation.mutateAsync();
    } catch {
      // `Stop reply` comes back, so the user can press it again.
      setStopTurnId(undefined);
    }
  }, [runningTurnId, stopMutation]);

  const {start: startRetry, cancel: cancelRetry} = retryPickup;
  const retry = useCallback(async () => {
    startRetry();
    try {
      await retryMutation.mutateAsync();
    } catch {
      // The failure stays on screen, so Retry is still there to press.
      cancelRetry();
    }
  }, [startRetry, cancelRetry, retryMutation]);

  return {
    detail: detailQuery.data,
    ...readState({conversationId, detailQuery, itemsQuery}),
    olderHistory: {
      hasMore: itemsQuery.hasNextPage,
      loading: itemsQuery.isFetchingNextPage,
      load: () => void itemsQuery.fetchNextPage(),
    },
    transcript,
    turn,
    activity,
    sendError: createMutation.error ?? sendMutation.error,
    retrying: retryMutation.isPending,
    send,
    stop,
    retry,
  };
}

function readState(params: {
  conversationId: string | undefined;
  detailQuery: ReturnType<typeof useConversationDetailQuery>;
  itemsQuery: ReturnType<typeof useConversationItemsQuery>;
}) {
  const {conversationId, detailQuery, itemsQuery} = params;
  const notFound =
    isConversationNotFound(detailQuery.error) || isConversationNotFound(itemsQuery.error);
  let loadError: typeof detailQuery | typeof itemsQuery | undefined;
  if (!notFound && detailQuery.isError) loadError = detailQuery;
  else if (!notFound && itemsQuery.isError) loadError = itemsQuery;
  return {
    notFound,
    loading: conversationId !== undefined && (detailQuery.isPending || itemsQuery.isPending),
    loadError,
  };
}

export type ChatConversation = ReturnType<typeof useChatConversation>;
