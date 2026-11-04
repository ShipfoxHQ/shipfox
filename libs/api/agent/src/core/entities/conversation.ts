import type {Buffer} from 'node:buffer';
import type {AgentTurnStatus, PageContextDto} from '@shipfox/api-agent-dto';

/** The `customType` of the entry that tells the timeline why a request got no turn. */
export const TURN_NOTICE_CUSTOM_TYPE = 'turn_notice';

/** The `customType` of the entry that reports a workflow run's result to the conversation that started it. */
export const RUN_RESULT_CUSTOM_TYPE = 'run_result';

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
  /** The content hash of the agent file that the pinned prompt came from. Null for the built-in agent without a file. */
  agentContentHash: string | null;
  originKind: ConversationOriginKind;
  ownerUserId: string | null;
  /** Where an integration conversation started. All three are set exactly when `originKind` is `integration`. */
  originConnectionId: string | null;
  originProvider: string | null;
  originKey: string | null;
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
  /** `unknown` on a write that an earlier attempt began, so no attempt knows if it took effect. */
  outcome?: 'unknown';
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
  /** The reasoning level the turn started with. Null for a turn opened without a model. */
  thinking: string | null;
  modelCallCount: number;
  startedAt: Date;
  finishedAt: Date | null;
}
