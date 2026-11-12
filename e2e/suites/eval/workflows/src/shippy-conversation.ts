import type {
  ConversationDetailDto,
  ConversationItemDto,
  CreateConversationResponseDto,
  ListConversationItemsResponseDto,
  PageContextDto,
} from '@shipfox/api-agent-dto';
import {type createApiClient, pollUntil} from '@shipfox/e2e-core';
import type {ConversationTurnRecord} from './shippy-checks.js';

type ApiClient = ReturnType<typeof createApiClient>;

const ITEMS_PAGE_SIZE = 100;

/**
 * Drives one web conversation through the public API, the way the chat panel does: the first
 * message creates the conversation, each later one joins it, and a turn is read back from the
 * timeline once it ends.
 */
export async function sendConversationMessage({
  client,
  projectId,
  conversationId,
  body,
  pageContext,
}: {
  client: ApiClient;
  projectId: string;
  /** Absent for the first message, which creates the conversation. */
  conversationId: string | undefined;
  body: string;
  pageContext: PageContextDto | undefined;
}): Promise<string> {
  const message = {
    client_message_id: crypto.randomUUID(),
    body,
    ...(pageContext === undefined ? {} : {page_context: pageContext}),
  };
  if (conversationId === undefined) {
    const created = await client.requestJson<CreateConversationResponseDto>(
      'post',
      `/projects/${projectId}/conversations`,
      {json: message},
    );
    return created.conversation.id;
  }
  await client.request('post', `/conversations/${conversationId}/messages`, {json: message});
  return conversationId;
}

/**
 * Waits for the turn a message started to end. The turn is new when its id differs from the
 * previous turn's, so a reply that ended before the message was sent is never mistaken for it.
 */
export async function waitForTurnEnd({
  client,
  conversationId,
  previousTurnId,
  timeoutMs,
  signal,
}: {
  client: ApiClient;
  conversationId: string;
  previousTurnId: string | null;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}): Promise<ConversationDetailDto> {
  let observed = 'no turn yet';
  return await pollUntil(
    {
      timeoutMs,
      intervalMs: 500,
      maxIntervalMs: 3_000,
      backoffFactor: 1.5,
      describe: () => `the end of a turn in conversation ${conversationId}: ${observed}`,
      ...(signal === undefined ? {} : {signal}),
    },
    async () => {
      const detail = await client.requestJson<ConversationDetailDto>(
        'get',
        `/conversations/${conversationId}`,
      );
      const turn = detail.latest_turn;
      observed = turn ? `${turn.id} ${turn.status}` : 'no turn yet';
      if (turn === null || turn.id === previousTurnId || turn.status === 'running') return null;
      return detail;
    },
  );
}

/** Every claimed item of the conversation, oldest first. */
export async function listConversationItems({
  client,
  conversationId,
}: {
  client: ApiClient;
  conversationId: string;
}): Promise<ConversationItemDto[]> {
  const items: ConversationItemDto[] = [];
  let afterSeq = 0;
  while (true) {
    const page = await client.requestJson<ListConversationItemsResponseDto>(
      'get',
      `/conversations/${conversationId}/items?after_seq=${afterSeq}&limit=${ITEMS_PAGE_SIZE}`,
    );
    items.push(...page.items);
    const last = page.items.at(-1);
    if (!page.has_more || last?.seq === null || last === undefined) return items;
    afterSeq = last.seq;
  }
}

/** The reply and the tool calls of one turn, read from its items. */
export function summarizeTurn({
  items,
  turnId,
  message,
  status,
  failureCode,
}: {
  items: readonly ConversationItemDto[];
  turnId: string;
  message: string;
  status: ConversationTurnRecord['status'];
  failureCode: string | null;
}): ConversationTurnRecord {
  const own = items.filter((item) => item.turn_id === turnId && item.content !== null);
  const denied = own.some((item) => item.content?.type === 'turn_notice');
  const rows = own.flatMap((item) => (item.content?.type === 'rows' ? item.content.rows : []));
  const replies = rows.flatMap((row) =>
    row.kind === 'message' && row.role === 'assistant' && row.text.trim() ? [row.text] : [],
  );
  const toolCalls = rows.flatMap((row) =>
    row.kind === 'tool-call' ? [{name: row.name, input: row.input}] : [],
  );
  return {
    message,
    status: denied ? 'denied' : status,
    failure_code: failureCode,
    reply: replies.join('\n\n'),
    tool_calls: toolCalls,
  };
}
