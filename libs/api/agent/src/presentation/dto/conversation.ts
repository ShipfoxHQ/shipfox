import type {
  ConversationActiveTurnDto,
  ConversationItemDto,
  ConversationSummaryDto,
} from '@shipfox/api-agent-dto';
import {isConversationUnread} from '#core/conversations.js';
import type {
  AgentTurn,
  OpenConversation,
  OpenConversationItem,
} from '#core/entities/conversation.js';

export function toConversationSummaryDto(conversation: OpenConversation): ConversationSummaryDto {
  return {
    id: conversation.id,
    project_id: conversation.projectId,
    agent_key: conversation.agentKey,
    title: conversation.title,
    unread: isConversationUnread(conversation),
    last_seq: conversation.lastSeq,
    last_agent_seq: conversation.lastAgentSeq,
    last_read_seq: conversation.lastReadSeq,
    last_activity_at: conversation.lastActivityAt.toISOString(),
    created_at: conversation.createdAt.toISOString(),
  };
}

export function toConversationItemDto(item: OpenConversationItem): ConversationItemDto {
  return {
    id: item.id,
    seq: item.seq,
    kind: item.kind,
    turn_id: item.turnId,
    author_user_id: item.authorUserId,
    client_message_id: item.clientMessageId,
    body: item.body,
    meta: item.meta,
    created_at: item.createdAt.toISOString(),
  };
}

export function toConversationActiveTurnDto(turn: AgentTurn): ConversationActiveTurnDto {
  return {
    id: turn.id,
    status: turn.status,
    started_at: turn.startedAt.toISOString(),
    stop_requested_at: turn.stopRequestedAt?.toISOString() ?? null,
  };
}
