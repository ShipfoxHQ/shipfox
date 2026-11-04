import type {SessionViewRow} from '@shipfox/client-logs';
import type {RequiredAction} from '@shipfox/policy-notice';
import type {ConversationTurnStatus, StreamedItem} from './conversation-stream.js';

export interface ConversationSummary {
  id: string;
  /** The agent the conversation talks to, fixed at creation. */
  agentKey: string;
  /** Null when the stored title can't be opened. */
  title: string | null;
  unread: boolean;
  lastSeq: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface ConversationList {
  conversations: readonly ConversationSummary[];
  nextCursor: string | undefined;
  /** Conversations with an unread reply, across every page. */
  unreadCount: number;
}

export interface ConversationTurn {
  id: string;
  status: ConversationTurnStatus;
  failureCode: string | null;
  stopRequested: boolean;
  model: string | null;
  provider: string | null;
}

/** A run the conversation started whose latest attempt has no result yet. */
export interface ActiveRun {
  runId: string;
  number: number;
  /** What the run is called, which is the workflow's name unless it set a run name. */
  name: string;
  attempt: number;
  status: string;
  /** Undefined while the attempt waits to start. */
  startedAt: string | undefined;
  jobsFinished: number;
  jobsTotal: number;
}

export interface ConversationDetail extends ConversationSummary {
  /** The most recent turn, finished or not. */
  latestTurn: ConversationTurn | undefined;
  /** Oldest first. */
  activeRuns: readonly ActiveRun[];
}

/** The result one run attempt delivered to the conversation. */
export interface RunResult {
  runId: string;
  attemptId: string;
  /** `settled` while a listener holds the run open, or the status the attempt ended with. */
  status: string;
  // Results stored before these fields existed have none of them.
  number: number | undefined;
  name: string | undefined;
  attempt: number | undefined;
}

export interface TurnNotice {
  code: string;
  message: string | null;
  requiredAction: RequiredAction | null;
}

export type ConversationItemContent =
  | {type: 'rows'; rows: readonly SessionViewRow[]}
  | {type: 'run_result'; result: RunResult}
  | {type: 'turn_notice'; notice: TurnNotice};

export interface ConversationItem extends StreamedItem {
  clientMessageId: string | null;
  /** Null when the stored entry can't be opened. */
  content: ConversationItemContent | null;
  createdAt: string;
}

export interface ConversationItemsPage {
  /** Claimed items in ascending `seq` order. */
  items: readonly ConversationItem[];
  /** Inputs waiting for a claim, oldest first. */
  queued: readonly ConversationItem[];
  hasMore: boolean;
}

/** Pages are newest first, because a conversation opens at its latest message. */
export function mergeItemPages(pages: readonly ConversationItemsPage[]): {
  items: ConversationItem[];
  queued: ConversationItem[];
} {
  const items = uniqueById(pages.flatMap((page) => page.items)).sort(
    (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
  );
  // Only the newest page reads the queue, so an older page can't bring back a claimed input.
  const claimed = new Set(items.map((item) => item.id));
  const queued = (pages[0]?.queued ?? []).filter((item) => !claimed.has(item.id));
  return {items, queued};
}

/** Adds what the stream sent to what the last read returned. An input leaves the queue once claimed. */
export function withLiveItems(
  base: {items: readonly ConversationItem[]; queued: readonly ConversationItem[]},
  live: {items: readonly ConversationItem[]; queued: readonly ConversationItem[]} | undefined,
): {items: ConversationItem[]; queued: ConversationItem[]} {
  const items = uniqueById([...base.items, ...(live?.items ?? [])]).sort(
    (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
  );
  const claimed = new Set(items.map((item) => item.id));
  const queued = uniqueById([...base.queued, ...(live?.queued ?? [])]).filter(
    (item) => !claimed.has(item.id),
  );
  return {items, queued};
}

export function lastItemSeq(items: readonly ConversationItem[]): number {
  return items.reduce((highest, item) => Math.max(highest, item.seq ?? 0), 0);
}

function uniqueById<T extends {id: string}>(values: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const value of values) seen.set(value.id, value);
  return [...seen.values()];
}
