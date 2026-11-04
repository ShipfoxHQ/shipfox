import {parseSessionRecord} from '@shipfox/agent-transcript';
import {
  type ConversationActiveRunDto,
  type ConversationActiveTurnDto,
  type ConversationItemContentDto,
  type ConversationItemDto,
  type ConversationLatestTurnDto,
  type ConversationSummaryDto,
  conversationRunResultDtoSchema,
  conversationTurnNoticeDtoSchema,
} from '@shipfox/api-agent-dto';
import type {ActiveRun} from '#core/active-runs.js';
import {isRecord, parseConversationEntry} from '#core/conversation-entries.js';
import {isConversationUnread} from '#core/conversations.js';
import {
  type AgentTurn,
  type OpenConversation,
  type OpenConversationItem,
  RUN_RESULT_CUSTOM_TYPE,
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

// The parser's fallback prints a whole message, so only these fields reach it. Signatures and
// block types a later pi version adds stay on the server.
const VISIBLE_ASSISTANT_BLOCK_FIELDS = new Map<string, readonly string[]>([
  ['text', ['type', 'text']],
  ['thinking', ['type', 'thinking']],
  ['toolCall', ['type', 'id', 'name', 'arguments']],
]);

function toVisibleAssistantBlocks(block: unknown): Record<string, unknown>[] {
  if (!isRecord(block) || typeof block.type !== 'string') return [];
  const fields = VISIBLE_ASSISTANT_BLOCK_FIELDS.get(block.type);
  return fields ? [Object.fromEntries(fields.map((field) => [field, block[field]]))] : [];
}

function toVisibleEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const {message} = entry;
  if (!isRecord(message) || !Array.isArray(message.content)) return entry;
  if (message.role === 'user') {
    return {...entry, message: {...message, content: message.content.slice(0, 1)}};
  }
  if (message.role === 'assistant') {
    return {
      ...entry,
      message: {...message, content: message.content.flatMap(toVisibleAssistantBlocks)},
    };
  }
  return entry;
}

function toRowsContent(item: OpenConversationItem, entry: string): ConversationItemContentDto {
  const parsed = parseConversationEntry(entry);
  const data = parsed ? JSON.stringify(toVisibleEntry(parsed)) : entry;
  const rows = parseSessionRecord({data, ts: item.createdAt.getTime()}, 'pi');
  // A `raw` row is the unparsed entry, and the chat ignores it, so only its label leaves.
  return {type: 'rows', rows: rows.map((row) => (row.kind === 'raw' ? {...row, raw: ''} : row))};
}

function toConversationItemContent(item: OpenConversationItem): ConversationItemContentDto | null {
  if (item.entry === null) return null;

  const parsed = parseConversationEntry(item.entry);
  if (parsed?.type === 'custom_message' && parsed.customType === RUN_RESULT_CUSTOM_TYPE) {
    const runResult = conversationRunResultDtoSchema.safeParse(parsed.details);
    if (runResult.success) return {type: 'run_result', run_result: runResult.data};
  }
  if (parsed?.type === 'custom' && parsed.customType === 'turn_notice') {
    const turnNotice = conversationTurnNoticeDtoSchema.safeParse(parsed.data);
    if (turnNotice.success) return {type: 'turn_notice', turn_notice: turnNotice.data};
  }
  return toRowsContent(item, item.entry);
}

export function toConversationItemDto(item: OpenConversationItem): ConversationItemDto {
  return {
    id: item.id,
    seq: item.seq,
    entry_type: item.entryType,
    turn_id: item.turnId,
    author_user_id: item.authorUserId,
    client_message_id: item.clientMessageId,
    content: toConversationItemContent(item),
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

export function toConversationLatestTurnDto(turn: AgentTurn): ConversationLatestTurnDto {
  return {
    ...toConversationActiveTurnDto(turn),
    failure_code: turn.failureCode,
    model: turn.model,
    provider: turn.provider,
    finished_at: turn.finishedAt?.toISOString() ?? null,
  };
}

export function toConversationActiveRunDto(run: ActiveRun): ConversationActiveRunDto {
  return {
    workflow_run_id: run.workflowRunId,
    run_number: run.runNumber,
    name: run.name,
    attempt: run.attempt,
    status: run.status,
    started_at: run.startedAt,
    jobs_finished: run.jobsFinished,
    jobs_total: run.jobsTotal,
  };
}
