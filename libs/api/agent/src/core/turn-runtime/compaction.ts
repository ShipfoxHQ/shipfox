import type {Message} from '@earendil-works/pi-ai';
import type {SessionEntry} from '@earendil-works/pi-coding-agent';
import {reportError} from '@shipfox/node-error-monitoring';
import {newConversationRecordId} from '#db/conversations.js';
import {appendTurnEntry, getConversationById, getTurnById, getTurnEntry} from '#db/turn-runtime.js';
import {conversationCompactionCount} from '#metrics/index.js';
import {CONVERSATION_SESSION_VERSION} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  sealConversationEntry,
} from '../conversation-sealing.js';
import {openConversationSession, type PiCodingAgent} from './conversation-session.js';
import {classifyProviderError, TurnFailure} from './failures.js';
import {
  type CreateModelRuntime,
  type ModelCallRuntime,
  translateModelSetupError,
} from './model-runtime.js';

export type CompactionCause = 'estimate' | 'overflow';

/**
 * Where a compaction entry sits among a turn's entries. A negative call index keeps it clear of
 * the turn's tool results, and of the model call's reply, which it must not share a position with.
 * It also makes a repeat after a crash find the entry it stored.
 */
export const COMPACTION_CALL_INDEX = -1;

type Preparation = Parameters<PiCodingAgent['compact']>[0];

const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * True when the assembled prompt, with its tool definitions, summary, and every message, is too
 * big for the model. The estimate is chars/4 and keeps no state. A window that isn't a positive
 * number turns the check off, and a provider overflow still catches the prompt.
 */
export function promptNeedsCompaction(params: {
  pi: PiCodingAgent;
  messages: Message[];
  contextWindow: number;
}): boolean {
  const {pi, messages, contextWindow} = params;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return false;
  const estimate = messages.reduce((total, message) => total + pi.estimateTokens(message), 0);
  return pi.shouldCompact(estimate, contextWindow, pi.DEFAULT_COMPACTION_SETTINGS);
}

function summarizableMessages(pi: PiCodingAgent, entries: SessionEntry[]) {
  // The system message is prompt state, and the compaction entry carries it forward.
  return entries
    .filter((entry) => entry.type !== 'compaction')
    .flatMap((entry) => pi.sessionEntryToContextMessages(entry))
    .filter((message) => message.role !== 'system');
}

/**
 * Chooses what to summarize and what to keep, from pi's public functions. pi 1.2.0 doesn't export
 * `prepareCompaction`, so this does the same work for a conversation with no branches and no
 * edits. Remove it when pi exports that function.
 *
 * Returns undefined when nothing is left to summarize: the prompt already ends in a compaction,
 * or everything fits in the part that is kept.
 */
export function prepareConversationCompaction(params: {
  pi: PiCodingAgent;
  session: ReturnType<PiCodingAgent['SessionManager']['inMemory']>;
}): Preparation | undefined {
  const {pi, session} = params;
  // The context starts with the latest compaction, then the entries it kept and those after it.
  const entries = session.buildContextEntries();
  const last = entries.at(-1);
  if (last === undefined || last.type === 'compaction') return undefined;

  const settings = pi.DEFAULT_COMPACTION_SETTINGS;
  const latest = entries[0]?.type === 'compaction' ? entries[0] : undefined;
  const boundaryStart = latest ? 1 : 0;
  const cut = pi.findCutPoint(entries, boundaryStart, entries.length, settings.keepRecentTokens);
  const firstKept = entries[cut.firstKeptEntryIndex];
  if (firstKept?.id === undefined) return undefined;

  const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptEntryIndex;
  const messagesToSummarize = summarizableMessages(pi, entries.slice(boundaryStart, historyEnd));
  const turnPrefixMessages = cut.isSplitTurn
    ? summarizableMessages(pi, entries.slice(cut.turnStartIndex, cut.firstKeptEntryIndex))
    : [];
  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;

  return {
    firstKeptEntryId: firstKept.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cut.isSplitTurn,
    tokensBefore: pi
      .convertToLlm(session.buildSessionContext().messages)
      .reduce((total, message) => total + pi.estimateTokens(message), 0),
    ...(latest ? {previousSummary: latest.summary} : {}),
    // Tools here are not file tools, so there is nothing to track.
    fileOps: {read: new Set(), written: new Set(), edited: new Set()},
    settings,
  };
}

// pi accepts a summary that was cut short by an abort, so the signal is checked before it is stored.
const interrupted = () =>
  new TurnFailure('provider_unavailable', 'The model call was interrupted', true);

async function summarize(params: {
  pi: PiCodingAgent;
  preparation: Preparation;
  runtime: ModelCallRuntime;
  conversationId: string;
  signal?: AbortSignal | undefined;
  heartbeat?: (() => void) | undefined;
}) {
  const {runtime} = params;
  const heartbeat = params.heartbeat
    ? setInterval(params.heartbeat, HEARTBEAT_INTERVAL_MS)
    : undefined;
  try {
    const result = await params.pi.compact(
      params.preparation,
      runtime.model,
      undefined,
      undefined,
      undefined,
      params.signal,
      runtime.thinking === 'default' || runtime.thinking === 'off'
        ? undefined
        : (runtime.thinking as Parameters<PiCodingAgent['compact']>[6]),
      // The summary goes through the turn's model and credentials, and its pinned fetch.
      (_model, context, options) => runtime.stream(context, options ?? {}),
      undefined,
      undefined,
      undefined,
      params.conversationId,
    );
    if (params.signal?.aborted) throw interrupted();
    return result;
  } catch (error) {
    if (error instanceof TurnFailure) throw error;
    if (params.signal?.aborted) throw interrupted();
    // Provider errors reach pi as text. A failed summary fails the turn, and Retry runs it again.
    throw classifyProviderError(error instanceof Error ? error.message : undefined);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

export interface CompactConversationParams {
  conversationId: string;
  turnId: string;
  modelCallIndex: number;
  cause?: CompactionCause | undefined;
  createModelRuntime: CreateModelRuntime;
  signal?: AbortSignal | undefined;
  heartbeat?: (() => void) | undefined;
}

/**
 * Summarizes the older part of the prompt and stores pi's compaction entry after everything on
 * the timeline. The entry carries the current system message, and `context_start_seq` moves to
 * the first entry kept. The timeline never changes, only what a prompt is built from. A repeat
 * after the entry committed finds it and calls no model.
 *
 * Returns false when nothing can be summarized, which means the prompt can't be made to fit.
 */
export async function compactConversation(
  params: CompactConversationParams,
): Promise<{compacted: boolean}> {
  const cause = params.cause ?? 'estimate';
  const [turn, conversation] = await Promise.all([
    getTurnById(params.turnId),
    getConversationById(params.conversationId),
  ]);
  if (!turn || !conversation) {
    throw new TurnFailure('internal_error', 'The turn or its conversation is gone', false);
  }
  const position = {
    turnId: turn.id,
    modelCallIndex: params.modelCallIndex,
    callIndex: COMPACTION_CALL_INDEX,
  };
  if (await getTurnEntry(position)) {
    conversationCompactionCount.add(1, {cause, outcome: 'replayed'});
    return {compacted: true};
  }

  try {
    const pi = await import('@earendil-works/pi-coding-agent');
    const {session} = await openConversationSession({conversation, pi});
    const preparation = prepareConversationCompaction({pi, session});
    if (!preparation) {
      conversationCompactionCount.add(1, {cause, outcome: 'nothing_to_compact'});
      return {compacted: false};
    }

    const runtime = await params
      .createModelRuntime({conversation, turn, renewal: turn.modelCallCount > 0})
      .catch(translateModelSetupError);
    const result = await summarize({
      pi,
      preparation,
      runtime,
      conversationId: conversation.id,
      signal: params.signal,
      heartbeat: params.heartbeat,
    });

    const entryId = session.appendCompaction(
      result.summary,
      result.firstKeptEntryId,
      result.tokensBefore,
      result.details,
      false,
      result.usage,
    );
    const {id: _id, parentId: _parentId, ...entry} = session.getEntry(entryId) as SessionEntry;
    const itemId = await newConversationRecordId();
    const appended = await appendTurnEntry({
      conversationId: conversation.id,
      position,
      completesModelCall: false,
      startContextAtItemId: result.firstKeptEntryId,
      entry: {
        id: itemId,
        entryType: 'compaction',
        sessionVersion: CONVERSATION_SESSION_VERSION,
        sealedEntry: sealConversationEntry({
          key: await conversationDataKey(conversation.workspaceId),
          aad: aadForConversationItem({
            workspaceId: conversation.workspaceId,
            conversationId: conversation.id,
            itemId,
          }),
          entry: JSON.stringify(entry),
        }),
        meta: {},
      },
    });
    if (!appended) {
      throw new TurnFailure('internal_error', 'The turn ended before its compaction', false);
    }
    conversationCompactionCount.add(1, {
      cause,
      outcome: appended.stored ? 'compacted' : 'replayed',
    });
    return {compacted: true};
  } catch (error) {
    conversationCompactionCount.add(1, {cause, outcome: 'failed'});
    if (!(error instanceof TurnFailure)) {
      reportError(error, {boundary: 'agent.conversation.compaction'});
    }
    throw error;
  }
}
