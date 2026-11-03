import type {ConversationTurn} from './conversation.js';
import type {ConversationTurnStatus} from './conversation-stream.js';

/** With no turn this long after a message, the start reads as slow. The sweep recovers it. */
export const SLOW_START_MS = 10_000;
/** A dropped stream reads as reconnecting only after this long, so a quick reconnect stays quiet. */
export const RECONNECTING_NOTICE_MS = 5_000;

export const STEP_LIMIT = 25;

export interface LiveTurn {
  turnId: string;
  status: ConversationTurnStatus;
  failureCode: string | null;
}

/**
 * The turn the panel shows. The stream knows a turn's end before the next read does, and a read
 * knows a turn the stream hasn't reached.
 */
export function currentTurn(params: {
  stored: ConversationTurn | undefined;
  live: LiveTurn | undefined;
}): ConversationTurn | undefined {
  const {stored, live} = params;
  if (!live) return stored;
  if (stored && stored.id !== live.turnId && stored.status === 'running') return stored;
  return {
    id: live.turnId,
    status: live.status,
    failureCode: live.failureCode,
    stopRequested: stored?.id === live.turnId ? stored.stopRequested : false,
    model: stored?.id === live.turnId ? stored.model : null,
    provider: stored?.id === live.turnId ? stored.provider : null,
  };
}

export type ReplyActivity =
  | {kind: 'idle'}
  | {kind: 'thinking'}
  | {kind: 'slow-start'}
  | {kind: 'replying'}
  | {kind: 'stopping'}
  | {kind: 'reconnecting'};

export function replyActivity(params: {
  turn: ConversationTurn | undefined;
  /** An input no turn has claimed yet, or a retry no turn has picked up yet. */
  awaitingTurn: boolean;
  /** No turn opened within `SLOW_START_MS`. */
  slowStart: boolean;
  partialText: string;
  stopRequested: boolean;
  /** The stream has been down for `RECONNECTING_NOTICE_MS`. */
  reconnecting: boolean;
}): ReplyActivity {
  const running = params.turn?.status === 'running';
  if (running && (params.stopRequested || params.turn?.stopRequested)) return {kind: 'stopping'};
  if (running && params.reconnecting) return {kind: 'reconnecting'};
  if (running) return params.partialText.trim() ? {kind: 'replying'} : {kind: 'thinking'};
  if (!params.awaitingTurn) return {kind: 'idle'};
  return params.slowStart ? {kind: 'slow-start'} : {kind: 'thinking'};
}

export function isReplyActive(activity: ReplyActivity): boolean {
  return activity.kind !== 'idle';
}

export type TurnFailureAction = 'retry' | 'continue' | 'new-conversation' | 'model-settings';

export interface TurnFailure {
  /** `model-unavailable` needs the workspace's models to tell a locked model from none. */
  kind: 'failed' | 'model-unavailable' | 'too-long' | 'step-limit';
  title: string;
  description: string | undefined;
  actions: readonly TurnFailureAction[];
}

const providerFailureCopy: Record<string, string> = {
  provider_error: 'The model provider returned an error.',
  provider_unavailable: "The model provider didn't respond.",
  timeout: 'The model took too long to respond.',
  credentials_unavailable: "Shippy couldn't load the model provider's credentials.",
  tool_catalog_unavailable: "Shippy's tools weren't available.",
  session_unreadable: "Shippy couldn't read this conversation.",
};

/** What a failed turn tells the reader. A failed call stores nothing, so this replaces its text. */
export function turnFailure(failureCode: string | null): TurnFailure {
  switch (failureCode) {
    case 'step_limit':
      return {
        kind: 'step-limit',
        title: `Stopped after ${STEP_LIMIT} steps.`,
        description: undefined,
        actions: ['continue'],
      };
    case 'context_overflow':
      return {
        kind: 'too-long',
        title: 'This conversation is too long to continue.',
        description: undefined,
        actions: ['new-conversation'],
      };
    case 'model_unavailable':
      return {
        kind: 'model-unavailable',
        title: "The workspace's model isn't available.",
        description: undefined,
        actions: ['model-settings', 'retry'],
      };
    default:
      return {
        kind: 'failed',
        title: "Shippy couldn't reply.",
        description: (failureCode && providerFailureCopy[failureCode]) ?? undefined,
        actions: ['retry'],
      };
  }
}

/** Notice codes the turn admission writes. */
export const ADMISSION_DENIED_NOTICE_CODE = 'admission-denied';

/** The notice a turn leaves when the conversation no longer fits the model. */
export const CONTEXT_OVERFLOW_NOTICE_CODE = 'context_overflow';

/** A denied message can be sent again once its cause is resolved. */
export function canSendAgain(code: string): boolean {
  return code === ADMISSION_DENIED_NOTICE_CODE;
}
