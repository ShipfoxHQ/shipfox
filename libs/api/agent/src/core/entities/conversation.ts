import type {Buffer} from 'node:buffer';
import type {
  AgentTurnStatus,
  ConversationItemKind,
  ConversationItemMetaDto,
} from '@shipfox/api-agent-dto';

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
  compactionThroughSeq: number;
  retryRequestedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
}

export interface OpenConversation extends Omit<Conversation, 'sealedTitle'> {
  title: string | null;
}

/**
 * One timeline entry. A queued input has a null `seq`, and a claim assigns it.
 * That is the only change an item ever sees.
 */
export interface ConversationItem {
  id: string;
  conversationId: string;
  seq: number | null;
  kind: ConversationItemKind;
  turnId: string | null;
  authorUserId: string | null;
  clientMessageId: string | null;
  sealedBody: Buffer;
  meta: ConversationItemMetaDto;
  createdAt: Date;
}

export interface OpenConversationItem extends Omit<ConversationItem, 'sealedBody'> {
  /** Null when the stored body can't be opened. */
  body: string | null;
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
