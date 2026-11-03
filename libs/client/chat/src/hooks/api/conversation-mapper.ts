import {
  type ConversationDetailDto,
  type ConversationItemContentDto,
  type ConversationItemDto,
  type ConversationLatestTurnDto,
  type ConversationSummaryDto,
  type ListConversationItemsResponseDto,
  type ListConversationsResponseDto,
  type PageContextDto,
  pageContextSchema,
} from '@shipfox/api-agent-dto';
import type {AgentPageContext} from '@shipfox/client-shell/runtime';
import type {
  ConversationDetail,
  ConversationItem,
  ConversationItemContent,
  ConversationItemsPage,
  ConversationList,
  ConversationSummary,
  ConversationTurn,
} from '#core/conversation.js';

export function toConversationSummary(dto: ConversationSummaryDto): ConversationSummary {
  return {
    id: dto.id,
    title: dto.title,
    unread: dto.unread,
    lastSeq: dto.last_seq,
    lastActivityAt: dto.last_activity_at,
    createdAt: dto.created_at,
  };
}

export function toConversationList(dto: ListConversationsResponseDto): ConversationList {
  return {
    conversations: dto.conversations.map(toConversationSummary),
    nextCursor: dto.next_cursor ?? undefined,
  };
}

function toConversationTurn(dto: ConversationLatestTurnDto): ConversationTurn {
  return {
    id: dto.id,
    status: dto.status,
    failureCode: dto.failure_code,
    stopRequested: dto.stop_requested_at !== null,
    model: dto.model,
    provider: dto.provider,
  };
}

export function toConversationDetail(dto: ConversationDetailDto): ConversationDetail {
  return {
    ...toConversationSummary(dto),
    latestTurn: dto.latest_turn ? toConversationTurn(dto.latest_turn) : undefined,
  };
}

function toItemContent(dto: ConversationItemContentDto): ConversationItemContent {
  switch (dto.type) {
    case 'rows':
      return {type: 'rows', rows: dto.rows};
    case 'run_result':
      return {type: 'run_result'};
    case 'turn_notice':
      return {
        type: 'turn_notice',
        notice: {
          code: dto.turn_notice.code,
          message: dto.turn_notice.message,
          requiredAction: dto.turn_notice.required_action,
        },
      };
  }
}

export function toConversationItem(dto: ConversationItemDto): ConversationItem {
  return {
    id: dto.id,
    seq: dto.seq,
    turnId: dto.turn_id,
    clientMessageId: dto.client_message_id,
    content: dto.content ? toItemContent(dto.content) : null,
    createdAt: dto.created_at,
  };
}

export function toConversationItemsPage(
  dto: ListConversationItemsResponseDto,
): ConversationItemsPage {
  return {
    items: dto.items.map(toConversationItem),
    queued: dto.queued.map(toConversationItem),
    hasMore: dto.has_more,
  };
}

/**
 * Only `page` and ids reach the prompt, and the API checks every id against the project. A page
 * that publishes a value the schema refuses sends no context, because it must never block a message.
 */
export function toPageContextDto(context: AgentPageContext): PageContextDto | undefined {
  const parsed = pageContextSchema.safeParse(pageContextBody(context));
  return parsed.success ? parsed.data : undefined;
}

function pageContextBody(context: AgentPageContext): Record<string, unknown> {
  switch (context.page) {
    case 'runs':
    case 'workflows':
      return {page: context.page};
    case 'run':
      return withoutUndefined({
        page: 'run',
        run_id: context.runId,
        attempt: context.attempt,
        status: statusToken(context.status),
      });
    case 'job':
      return withoutUndefined({
        page: 'job',
        run_id: context.runId,
        job_id: context.jobId,
        attempt: context.attempt,
        step_id: context.stepId,
        status: statusToken(context.status),
      });
    case 'workflow':
      return {page: 'workflow', definition_id: context.definitionId};
    case 'project_settings':
      return {page: 'project_settings', section: context.section};
  }
}

const STATUS_TOKEN = /^[a-z_]{1,32}$/;

// Status only picks suggested prompts, so an unexpected value is dropped rather than refused.
function statusToken(status: string | undefined): string | undefined {
  return status !== undefined && STATUS_TOKEN.test(status) ? status : undefined;
}

function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
