import type {Buffer} from 'node:buffer';
import type {AgentTurnStatus, PageContextDto} from '@shipfox/api-agent-dto';

/** The `customType` of the entry that tells the timeline why a request got no turn. */
export const TURN_NOTICE_CUSTOM_TYPE = 'turn_notice';

export type ConversationOriginKind = 'web' | 'integration';

/**
 * One agent conversation. `originKind` is fixed at creation and decides who can
 * reach the conversation: a web conversation belongs to `ownerUserId` alone.
 */
export interface Conversation {
  id: string;
  workspaceId: string;
  projectId: string;
  agentKey: string;
  originKind: ConversationOriginKind;
  ownerUserId: string | null;
  /** The first message's client ID, so a repeated create finds this conversation. */
  clientMessageId: string | null;
  sealedTitle: Buffer | null;
  lastSeq: number;
  lastAgentSeq: number;
  lastReadSeq: number;
  runStartsSinceHuman: number;
  contextStartSeq: number;
  retryRequestedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
}

export interface OpenConversation extends Omit<Conversation, 'sealedTitle'> {
  title: string | null;
}

/** Plain facts about an entry. It holds nothing a user typed. */
export interface ConversationItemMeta {
  role?: string;
  page_context?: PageContextDto;
  /** The `customType` of a `custom` entry, so a query can find one without opening bodies. */
  custom_type?: string;
  stop_reason?: string;
  model?: string;
  tool_call_id?: string;
  tool_name?: string;
  is_error?: boolean;
}

/**
 * One pi session entry on the timeline. A queued input has a null `seq`, and a
 * claim assigns it. That is the only change an item ever sees.
 */
export interface ConversationItem {
  id: string;
  conversationId: string;
  seq: number | null;
  entryType: string;
  sessionVersion: number;
  turnId: string | null;
  modelCallIndex: number | null;
  callIndex: number | null;
  authorUserId: string | null;
  clientMessageId: string | null;
  sealedEntry: Buffer;
  meta: ConversationItemMeta;
  createdAt: Date;
}

export interface OpenConversationItem extends Omit<ConversationItem, 'sealedEntry'> {
  /** The pi entry as stored, or null when it can't be opened. */
  entry: string | null;
}

export interface AgentTurn {
  id: string;
  conversationId: string;
  status: AgentTurnStatus;
  failureCode: string | null;
  stopRequestedAt: Date | null;
  model: string | null;
  provider: string | null;
  modelCallCount: number;
  startedAt: Date;
  finishedAt: Date | null;
}
